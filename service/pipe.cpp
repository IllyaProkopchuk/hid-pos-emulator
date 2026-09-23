#include "pipe.h"

#include <sddl.h>

#include <algorithm>

namespace hidposemu {

namespace {

constexpr DWORD kInstanceCount = 4;
constexpr DWORD kBufferSize = 16 * 1024;

//
// SYSTEM and Administrators get full control, authenticated users read and write: the Node host
// runs unelevated and must be able to connect.
//
const wchar_t* const kPipeSddl = L"D:(A;;GA;;;SY)(A;;GA;;;BA)(A;;GRGW;;;AU)";

struct SecurityAttributes
{
    SECURITY_ATTRIBUTES attributes = {};

    ~SecurityAttributes()
    {
        if (attributes.lpSecurityDescriptor != nullptr) {
            ::LocalFree(attributes.lpSecurityDescriptor);
        }
    }

    bool Build(DWORD& win32Error)
    {
        PSECURITY_DESCRIPTOR descriptor = nullptr;

        if (!::ConvertStringSecurityDescriptorToSecurityDescriptorW(kPipeSddl,
                    SDDL_REVISION_1, &descriptor, nullptr)) {
            win32Error = ::GetLastError();
            return false;
        }

        attributes.nLength = sizeof(attributes);
        attributes.lpSecurityDescriptor = descriptor;
        attributes.bInheritHandle = FALSE;

        return true;
    }
};

//
// Runs one overlapped operation to completion, or gives up when the service is stopping.
//
bool WaitForOverlapped(HANDLE pipe, OVERLAPPED& overlapped, HANDLE stopEvent, DWORD& transferred)
{
    HANDLE waitHandles[2] = { overlapped.hEvent, stopEvent };

    if (::WaitForMultipleObjects(2, waitHandles, FALSE, INFINITE) != WAIT_OBJECT_0) {
        ::CancelIoEx(pipe, &overlapped);
        return false;
    }

    return ::GetOverlappedResult(pipe, &overlapped, &transferred, FALSE) != FALSE;
}

}  // namespace

PipeServer::PipeServer(RequestHandler requestHandler, GreetingProvider greetingProvider)
    : requestHandler_(std::move(requestHandler))
    , greetingProvider_(std::move(greetingProvider))
{
}

PipeServer::~PipeServer()
{
    Stop();
}

bool PipeServer::Start(std::string& errorMessage, DWORD& win32Error)
{
    stopEvent_ = ::CreateEventW(nullptr, TRUE, FALSE, nullptr);

    if (stopEvent_ == nullptr) {
        errorMessage = "cannot create the stop event";
        win32Error = ::GetLastError();
        return false;
    }

    for (DWORD index = 0; index < kInstanceCount; ++index) {
        threads_.emplace_back(&PipeServer::RunInstance, this);
    }

    errorMessage.clear();
    win32Error = ERROR_SUCCESS;

    return true;
}

void PipeServer::Stop()
{
    if (stopEvent_ == nullptr) {
        return;
    }

    ::SetEvent(stopEvent_);

    {
        std::lock_guard<std::mutex> guard(clientsMutex_);

        // A client thread is parked in an overlapped ReadFile; cancelling its I/O is what makes it
        // notice the stop event.
        for (const auto& client : clients_) {
            ::CancelIoEx(client->pipe, nullptr);
        }
    }

    for (std::thread& thread : threads_) {
        if (thread.joinable()) {
            thread.join();
        }
    }

    threads_.clear();
    ::CloseHandle(stopEvent_);
    stopEvent_ = nullptr;
}

void PipeServer::Broadcast(const std::string& line)
{
    std::vector<std::shared_ptr<Client>> clients;

    {
        std::lock_guard<std::mutex> guard(clientsMutex_);

        clients = clients_;
    }

    for (const auto& client : clients) {
        WriteLine(client, line);
    }
}

bool PipeServer::WriteLine(const std::shared_ptr<Client>& client, const std::string& line)
{
    std::lock_guard<std::mutex> guard(client->writeMutex);

    OVERLAPPED overlapped = {};

    overlapped.hEvent = ::CreateEventW(nullptr, TRUE, FALSE, nullptr);

    if (overlapped.hEvent == nullptr) {
        return false;
    }

    DWORD written = 0;
    bool ok = ::WriteFile(client->pipe, line.data(), static_cast<DWORD>(line.size()),
                          &written, &overlapped) != FALSE;

    if (!ok && ::GetLastError() == ERROR_IO_PENDING) {
        ok = WaitForOverlapped(client->pipe, overlapped, stopEvent_, written);
    }

    ::CloseHandle(overlapped.hEvent);

    return ok && written == line.size();
}

void PipeServer::RunInstance()
{
    while (::WaitForSingleObject(stopEvent_, 0) != WAIT_OBJECT_0) {
        SecurityAttributes security;
        DWORD win32Error = ERROR_SUCCESS;

        if (!security.Build(win32Error)) {
            return;
        }

        const HANDLE pipe = ::CreateNamedPipeW(HIDPOSEMU_PIPE_NAME,
                                PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED,
                                // Messages out, bytes in: the host sends newline terminated JSON
                                // as a plain stream, so reading in byte mode is what matches it.
                                PIPE_TYPE_MESSAGE | PIPE_READMODE_BYTE | PIPE_WAIT,
                                kInstanceCount,
                                kBufferSize,
                                kBufferSize,
                                0,
                                &security.attributes);

        if (pipe == INVALID_HANDLE_VALUE) {
            ::Sleep(1000);
            continue;
        }

        OVERLAPPED overlapped = {};

        overlapped.hEvent = ::CreateEventW(nullptr, TRUE, FALSE, nullptr);

        if (overlapped.hEvent == nullptr) {
            ::CloseHandle(pipe);
            return;
        }

        DWORD transferred = 0;
        bool connected = ::ConnectNamedPipe(pipe, &overlapped) != FALSE;

        if (!connected) {
            const DWORD error = ::GetLastError();

            if (error == ERROR_IO_PENDING) {
                connected = WaitForOverlapped(pipe, overlapped, stopEvent_, transferred);
            }
            else if (error == ERROR_PIPE_CONNECTED) {
                connected = true;
            }
        }

        ::CloseHandle(overlapped.hEvent);

        if (!connected) {
            ::CloseHandle(pipe);
            continue;
        }

        auto client = std::make_shared<Client>();

        client->pipe = pipe;

        {
            std::lock_guard<std::mutex> guard(clientsMutex_);

            clients_.push_back(client);
        }

        ServeClient(client);

        {
            std::lock_guard<std::mutex> guard(clientsMutex_);

            clients_.erase(std::remove(clients_.begin(), clients_.end(), client), clients_.end());
        }

        ::FlushFileBuffers(pipe);
        ::DisconnectNamedPipe(pipe);
        ::CloseHandle(pipe);
    }
}

void PipeServer::ServeClient(const std::shared_ptr<Client>& client)
{
    if (!WriteLine(client, greetingProvider_())) {
        return;
    }

    std::string buffer;
    std::vector<char> chunk(kBufferSize);
    OVERLAPPED overlapped = {};

    overlapped.hEvent = ::CreateEventW(nullptr, TRUE, FALSE, nullptr);

    if (overlapped.hEvent == nullptr) {
        return;
    }

    for (;;) {
        ::ResetEvent(overlapped.hEvent);

        DWORD read = 0;
        bool ok = ::ReadFile(client->pipe, chunk.data(), static_cast<DWORD>(chunk.size()),
                             &read, &overlapped) != FALSE;

        if (!ok && ::GetLastError() == ERROR_IO_PENDING) {
            ok = WaitForOverlapped(client->pipe, overlapped, stopEvent_, read);
        }

        if (!ok || read == 0) {
            break;
        }

        buffer.append(chunk.data(), read);

        for (;;) {
            const size_t newline = buffer.find('\n');

            if (newline == std::string::npos) {
                break;
            }

            const std::string line = buffer.substr(0, newline);

            buffer.erase(0, newline + 1);

            if (line.empty()) {
                continue;
            }

            if (!WriteLine(client, requestHandler_(line))) {
                ::CloseHandle(overlapped.hEvent);
                return;
            }
        }

        // A client that never sends a newline would otherwise grow this buffer without bound.
        if (buffer.size() > kBufferSize) {
            break;
        }
    }

    ::CloseHandle(overlapped.hEvent);
}

}  // namespace hidposemu
