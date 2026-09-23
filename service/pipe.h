//
// The named pipe HidPosEmuSvc listens on. One thread per pipe instance, four instances, which is
// also the client limit: a developer machine runs one host, the spare instances are there for a
// second host or a stale connection.
//

#pragma once

#include <windows.h>

#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#define HIDPOSEMU_PIPE_NAME L"\\\\.\\pipe\\HidPosEmu"

namespace hidposemu {

class PipeServer
{
public:
    using RequestHandler = std::function<std::string(const std::string& line)>;
    using GreetingProvider = std::function<std::string()>;

    PipeServer(RequestHandler requestHandler, GreetingProvider greetingProvider);
    ~PipeServer();

    PipeServer(const PipeServer&) = delete;
    PipeServer& operator=(const PipeServer&) = delete;

    bool Start(std::string& errorMessage, DWORD& win32Error);
    void Stop();

    //
    // Sends one line to every connected client. Used for the `device` events, which nobody asked
    // for by id.
    //
    void Broadcast(const std::string& line);

private:
    struct Client
    {
        HANDLE      pipe = INVALID_HANDLE_VALUE;
        std::mutex  writeMutex;
    };

    void RunInstance();
    void ServeClient(const std::shared_ptr<Client>& client);
    bool WriteLine(const std::shared_ptr<Client>& client, const std::string& line);

    RequestHandler                          requestHandler_;
    GreetingProvider                        greetingProvider_;
    HANDLE                                  stopEvent_ = nullptr;
    std::vector<std::thread>                threads_;
    std::mutex                              clientsMutex_;
    std::vector<std::shared_ptr<Client>>    clients_;
};

}  // namespace hidposemu
