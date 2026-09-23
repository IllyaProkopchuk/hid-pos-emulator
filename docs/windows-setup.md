# Встановлення на Windows 11: від нуля до працюючого емулятора

Цей файл самодостатній. Його можна відкрити в новому чаті без жодного попереднього контексту і йти
згори вниз. Кожен крок має перевірку: якщо перевірка не проходить, далі йти не можна.

---

## 0. Що ти встановлюєш і навіщо

`hid-pos-emulator` створює **віртуальний USB-сканер штрихкодів** на рівні Windows. Застосунок, який
ти тестуєш, читає сканер через браузерний API `navigator.hid`, а браузер бачить лише ті пристрої,
які йому дала операційна система. Тому підробка живе не в браузері, а в драйвері: для Chrome,
Electron і самого застосунку це звичайний сканер Newland NLS-HR22, встромлений у USB.

Три частини, які ти встановиш:

| Частина | Що це | Де живе після установки |
| ------- | ----- | ----------------------- |
| `HidPosEmu.dll` | UMDF-драйвер, вдає сканер перед Windows | сховище драйверів Windows (`pnputil`) |
| `HidPosEmuSvc.exe` | служба, створює і прибирає пристрій, штовхає в нього байти | `%ProgramFiles%\HidPosEmu\` |
| `host/` | Node-застосунок і сторінка керування | тека репозиторію, запускається вручну |

Драйвер користувацького режиму (UMDF) **не потребує** ні підпису Microsoft, ні вимкненого Secure
Boot, ні режиму test signing. Достатньо самопідписаного сертифіката, який інсталятор додає в довірені
сховища машини. Права адміністратора потрібні двічі: при установці і при створенні пристрою, тому
створенням займається служба, а не сам застосунок.

Цільова машина: **Windows 11 x64**, білд 22000 або новіший, Secure Boot увімкнений, test signing
вимкнений, **Smart App Control вимкнений**.

Останній пункт не обговорюється. Smart App Control взагалі не дає запустити самопідписаний бінарник —
ні як службу, ні з консолі, — тож із ним увімкненим служба не стартує, хоч би все інше було
правильним. Перевір це найпершим, `0` означає «вимкнено»:

```powershell
(Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy' -Name VerifiedAndReputablePolicyState).VerifiedAndReputablePolicyState
```

Якщо повертає `1` — Windows Security → App & browser control → Smart App Control settings → Off.
Вимкнення незворотне: увімкнути назад можна лише скиданням Windows.

> **Якщо ти не збираєш проєкт, а лише ставиш готовий реліз, більшість цього файлу тобі не потрібна.**
> Запусти `HidPosEmu-<версія>-Setup.exe` («Докладніше» → «Все одно запустити»), погодься на UAC,
> «Далі» → «Встановити», перезавантаж Windows, якщо попросить, і запусти ярлик **HID-POS emulator**
> з меню «Пуск». Покроково, і як ставити з zip, — у `README-install.md`. Ні Visual Studio, ні SDK,
> ні WDK, ні Node, ні yarn при цьому не потрібні: Node вбудований у реліз, а `install.ps1`
> користується лише `certutil`, `pnputil` і `sc.exe`, які вже є у Windows. Smart App Control має
> бути вимкнений (див. вище).

---

## 1. Тулчейн для збірки

Драйвер і служба написані на C і C++ і збираються лише тут: MSVC і WDK існують тільки під Windows.
Збірка перевірена на Visual Studio 2026 з WDK 10.0.28000 і проходить чисто; якщо в тебе інша пара
версій і зʼявляються помилки, дивись розділ 9.

Microsoft жорстко звʼязує версію Visual Studio з версією WDK, а номери білдів SDK і WDK **мають
збігатися**. Обери одну пару і тримайся її:

| Пара | Visual Studio | SDK + WDK |
| ---- | ------------- | --------- |
| поточна (рекомендована) | 2026, Community або Build Tools | 10.0.28000.x |
| старіша | 2022 | 10.0.26100.6584 |

Далі всі кроки для поточної пари.

### 1.1 Visual Studio 2026 Build Tools

Повна IDE не потрібна: `build.ps1` викликає `msbuild` з командного рядка. Build Tools офіційно
підтримують WDK починаючи з релізу 2026.

1. Відкрий <https://visualstudio.microsoft.com/downloads/>
2. Прокрути до **Tools for Visual Studio** → **Build Tools for Visual Studio 2026** → Download.
3. Запусти інсталятор, вкладка **Workloads** → постав **Desktop development with C++**.
4. Вкладка **Individual components**, у пошуку введи `spectre` і постав:
   - C++ Spectre-mitigated libraries for x64/x86 (Latest MSVC)
   - C++ ATL with Spectre mitigations for x64/x86 (Latest MSVC)
   - C++ MFC with Spectre mitigations for x64/x86 (Latest MSVC)

   ARM64-варіанти не потрібні, збірка тільки x64. Без Spectre-бібліотек драйверний проєкт не
   збереться: WDK вимагає їх за замовчуванням.
5. У тій же вкладці знайди і постав **Windows Driver Kit**. Це VSIX-інтеграція. Без неї `msbuild` не
   вміє будувати проєкт із `DriverType=UMDF`.
6. **Install.** Це найдовший крок, 4 to 6 ГБ.

### 1.2 Windows SDK

Workload з кроку 1.1 ставить не ту версію SDK, тож цей крок обовʼязковий.

1. <https://developer.microsoft.com/windows/downloads/windows-sdk/>
2. Завантаж і встанови останню версію.

### 1.3 Windows Driver Kit

Ставиться **після** SDK.

1. <https://learn.microsoft.com/windows-hardware/drivers/download-the-wdk>
2. Встанови.
3. Якщо інсталятор скаже, що не знаходить WDK VSIX: відкрий Visual Studio Installer → **Modify** →
   **Individual components** → постав **Windows Driver Kit** → **Modify**, потім запусти інсталятор
   WDK ще раз.

### 1.4 Node і Git

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
```

Закрий і відкрий PowerShell, щоб підхопився PATH, потім:

```powershell
npm i -g yarn@1.22.22
```

### Перевірка кроку 1

```powershell
& "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * -requires Microsoft.Component.MSBuild -property installationPath
Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Directory | Select-Object -ExpandProperty Name
Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Filter inf2cat.exe -Recurse | Select-Object -First 1 -ExpandProperty FullName
node --version
yarn --version
```

Очікуєш:

- `vswhere` друкує шлях до інсталяції Visual Studio. Порожньо означає, що MSBuild не встановився.
- серед тек `Windows Kits\10\bin` є `10.0.28000.x`. Якщо є тільки старіші номери, SDK або WDK не став.
- `inf2cat.exe` знайдено. Це файл із WDK: якщо його немає, WDK не встановлений, хоч би що показував
  список програм.
- `node --version` друкує `v20.x`, `yarn --version` друкує `1.22.x`.

---

## 2. Перенести репозиторій на цю машину

Два варіанти:

- **Клон.** `git clone` репозиторію з GitHub у `C:\work`.
- **Копія.** Скопіюй теку `hid-pos-emulator` цілком (флешка, мережева шара, архів). Тека
  `host/node_modules` не потрібна, її створить `yarn`.

Далі гайд припускає, що репозиторій лежить у `C:\work\hid-pos-emulator`. Підстав свій
шлях, якщо інший.

### Перевірка кроку 2

```powershell
cd C:\work\hid-pos-emulator
Test-Path .\driver\HidPosEmu.sln, .\service\HidPosEmuSvc.sln, .\installer\build.ps1, .\host\package.json
```

Чотири рази `True`.

---

## 3. Хост окремо, до всякого драйвера

Це найшвидший спосіб переконатися, що половина системи жива, і не потребує ні адміна, ні драйвера.

```powershell
cd C:\work\hid-pos-emulator\host
yarn
yarn test
yarn typecheck
```

### Перевірка кроку 3

`yarn test` друкує `# pass 25` і `# fail 0`. `yarn typecheck` завершується без помилок.

Якщо тут щось падає, драйвер ні до чого: проблема в Node або в копії репозиторію.

---

## 4. Зібрати драйвер і службу

```powershell
cd C:\work\hid-pos-emulator
.\installer\build.ps1 -Version 1.0.0
```

Що робить скрипт:

1. Знаходить `msbuild`, `inf2cat` і `signtool` через `vswhere` і теки Windows Kits.
2. Якщо `installer\HidPosEmu.pfx` немає, створює самопідписаний сертифікат на 5 років і експортує
   пару `.pfx` (у git не потрапляє) та `.cer` (їде в архів).
3. Збирає `driver\HidPosEmu.sln` і `service\HidPosEmuSvc.sln` у конфігурації Release, платформа x64.
4. Складає корисне навантаження в `out\package\`, робить каталог `HidPosEmu.cat` через `inf2cat` і
   підписує каталог, `HidPosEmu.dll` і `HidPosEmuSvc.exe`.
5. Пакує `out\HidPosEmu-1.0.0-x64.zip`.

**Сертифікат бережи.** Заміна `HidPosEmu.pfx` означає, що кожна машина має заново імпортувати новий
`.cer`.

### Перевірка кроку 4

```powershell
Test-Path .\out\HidPosEmu-1.0.0-x64.zip
Get-ChildItem .\out\package -Recurse -File | Select-Object -ExpandProperty Name
```

Очікуєш архів і в ньому: `HidPosEmu.dll`, `HidPosEmu.inf`, `HidPosEmu.cat`, `HidPosEmuSvc.exe`,
`HidPosEmu.cer`, `Install.cmd`, `Uninstall.cmd`, `install.ps1`, `uninstall.ps1`, `HidPosEmu.cmd`,
`HidPosEmu.ico`, `README-install.md`.

**Якщо збірка впала — це нормально для першого разу.** Іди в розділ 9.

---

## 5. Встановити

```powershell
Expand-Archive .\out\HidPosEmu-1.0.0-x64.zip -DestinationPath C:\Tools\HidPosEmu -Force
```

Далі відкрий PowerShell **від адміністратора** і запусти:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
C:\Tools\HidPosEmu\install.ps1
```

Перший рядок потрібен, бо за замовчуванням Windows не дає виконувати скрипти; `-Scope Process` діє
лише в цьому вікні й нічого не змінює в системі. Не запускай скрипт через «Run with PowerShell» з
провідника: у Windows 11 той пункт не обходить політику, і завантажений скрипт просто не запуститься.
Колегам, які ставлять готовий реліз, досить двічі клацнути `Install.cmd`: він обходить політику,
скрипт сам просить права адміна, а вікно з результатом лишається відкритим.

Що робить скрипт, по порядку:

1. Перевіряє, що test signing вимкнений, і **відмовляється працювати**, якщо він увімкнений. Сам він
   його ніколи не вмикає: машина в test signing приховала б зламаний підпис.
2. Імпортує `HidPosEmu.cer` у сховища **Trusted Root Certification Authorities** і **Trusted
   Publishers**.
3. `pnputil /add-driver HidPosEmu.inf /install` кладе пакет драйвера у сховище Windows.
4. Копіює службу в `%ProgramFiles%\HidPosEmu\`, створює службу `HidPosEmuSvc` з автозапуском і
   стартує її.
5. Друкує стан служби і чи доступний канал `\\.\pipe\HidPosEmu`.

Скрипт ідемпотентний: повторний запуск оновить драйвер і перезапустить службу, не створюючи другу
службу і не дублюючи сертифікат.

**Після першої установки на машині перезавантажся.** Windows уперше розкладає власні файли UMDF для
HID-стека і пише в `C:\Windows\inf\setupapi.dev.log` код `ERROR_SUCCESS_REBOOT_REQUIRED` (`0xbc3`);
доки не перезавантажишся, пристрій створюється, але не стартує, і selftest падає з
`the device has no HID interface`. Служба після перезавантаження підніметься сама, вона на
автозапуску.

### Перевірка кроку 5

```powershell
Get-Service HidPosEmuSvc
pnputil /enum-drivers | Select-String -Context 2 HidPosEmu
bcdedit /enum '{current}' | Select-String testsigning
Test-Path '\\.\pipe\HidPosEmu'
```

Очікуєш: служба `Running`; `pnputil` показує запис із `HidPosEmu.inf`; `testsigning` **не** друкує
нічого або друкує `No`; шлях каналу `True`.

---

## 6. Самотест служби

Це перевірка всього ланцюга без браузера і без застосунку. Виконати з правами адміністратора:

```powershell
& "$env:ProgramFiles\HidPosEmu\HidPosEmuSvc.exe" --selftest
echo $LASTEXITCODE
```

Самотест створює пристрій `newland`, вкидає в нього репорт для тікета `221-3351-753`, відкриває
пристрій як звичайний HID-клієнт, читає репорт назад, звіряє байти і прибирає пристрій.

### Перевірка кроку 6

`$LASTEXITCODE` дорівнює `0`. У разі невдачі скрипт друкує причину текстом.

Очікувані байти: `[0x02, 0x0d, '2','2','1','-','3','3','5','1','-','7','5','3', 0x0d]`. Другий байт
`0x0d` — це довжина корисних даних за форматом Newland, яка враховує термінатор: 12 символів
`221-3351-753` плюс CR.

---

## 7. Запустити емулятор

```powershell
cd C:\work\hid-pos-emulator\host
yarn start
```

Відкрий <http://localhost:7411>.

Якщо ти ставив готовий реліз, а не збирав із чекауту, запусти ярлик **HID-POS emulator** з меню
«Пуск» або з робочого столу — його створив Setup.exe чи `install.ps1`. Сторінка відкриється окремим
вікном, а в панелі задач з'явиться згорнуте вікно консолі: це і є емулятор, закриєш його — емулятор
зупиниться. Node вбудований у реліз. Без ярлика те саме робить, з теки встановлення
(`C:\Program Files\HidPosEmu` після Setup.exe):

```powershell
.\host\node\node.exe .\host\bin\server.mjs
```

### Перевірка кроку 7

Панель показує **Service: connected, driver installed**.

Далі:

1. Натисни **Plug in** для профілю `newland`.
2. Перевір, що пристрій піднявся чисто:

   ```powershell
   Get-PnpDevice | Where-Object { $_.InstanceId -like '*HIDPOSEMU*' -and $_.Problem -ne 'CM_PROB_PHANTOM' } |
     Format-List InstanceId, FriendlyName, Status, Problem, Class
   ```

   Очікуєш дві сутності: батьківську `SWD\HidPosEmu\newland` і дочірню `HID\HidPosEmu\...` з іменем
   **`HID-compliant device`**, обидві `OK` / `CM_PROB_NONE`. Якщо дочірня має клас `BarcodeScanner` і
   `CM_PROB_FAILED_START` — це відомий випадок, дивись розділ 9.
3. Відкрий Chrome, будь-яку сторінку на `localhost`, і в консолі виконай:

   ```js
   await navigator.hid.requestDevice({ filters: [{ usagePage: 0x8c }] })
   ```

   У діалозі має бути `NLS-HR22`. Обери його: повернеться пристрій із `vendorId 7851` (`0x1eab`),
   `productId 14608` (`0x3910`) і колекцією `usagePage 0x8c` / `usage 0x03`.

Що вже перевірено на реальній машині: перелік інтерфейсів `GUID_DEVINTERFACE_HID` тим самим шляхом,
яким іде Chrome, повертає `NLS-HR22`, `0x1eab` / `0x3910`, серійник `EMU-NEWLAND-0001`, usage page
`0x8c`, usage `0x03`; окремий процес відкрив цей інтерфейс і прочитав із нього справжній скан
(`02 0d 32 32 31 …`, report id 2, текст `221-3351-753`). Неперевіреним лишається тільки сам діалог
вибору пристрою в Chrome, бо `requestDevice` вимагає справжнього кліку.

---

## 8. Перевірити зі своїм застосунком

Запусти застосунок, який читає сканер через `navigator.hid`, і підключи в ньому сканер NLS-HR22, як
справжній. У панелі емулятора обери пресет `ticketBarcode` і натисни **Scan**: застосунок отримає
`221-3351-753`, ніби код просканували справжнім сканером.

Повний список із 17 критеріїв приймання — у [`windows-runbook.md`](windows-runbook.md), розділ 6, і
в [`../host/README.md`](../host/README.md). Там же профілі, пресети і режими збоїв, якими
відтворюються реальні баги (наприклад `unknownVendorLengthByte` дає симптом `8https://...`, коли
байт довжини читається як символ).

**Важливо:** код застосунку не змінюється взагалі. Перед тестами і після них `git status` у його
репозиторії має бути чистим.

---

## 9. Що робити, коли щось не працює

### Збірка драйвера падає на помилках компіляції

Очікувано на першому запуску: код писався без компілятора. Збери повний вивід і працюй з ним як зі
звичайними помилками компіляції:

```powershell
.\installer\build.ps1 -Version 1.0.0 2>&1 | Tee-Object -FilePath build.log
Select-String -Path build.log -Pattern 'error' -Context 0,2
```

Файли, де найімовірніші проблеми: `driver\hidposemu.c` (найбільший, 1101 рядок), `service\swdevice.cpp`,
`service\hid.cpp`. Орієнтир для драйвера — офіційний зразок Microsoft `hid/vhidmini2`, з якого його
й виводили.

### `msbuild` не знайдено або не будує драйверний проєкт

Найчастіша причина — не поставлений компонент **Windows Driver Kit** у Visual Studio Installer.
Перевір крок 1.1 пункт 5 і перевстанови WDK після цього.

### `inf2cat` не знайдено

WDK не встановлений або встановлений із номером білда, який не збігається з SDK. Перевірка кроку 1
покаже обидва номери.

### Жовтий знак оклику на пристрої в Диспетчері пристроїв

Спершу подивись **клас** пристрою, що впав — від нього залежить усе інше.

Клас **`BarcodeScanner`**, імʼя `POS HID Barcode scanner`, статус `CM_PROB_FAILED_START` і
`STATUS_DEVICE_POWER_FAILURE` (`0xC000009E`) — це не наш драйвер. Windows підвʼязала до колекції
власний `hidscanner.inf`, чий єдиний compatible id — `HID_DEVICE_UP:008C_U:0002`, і той драйвер не
стартує на нашому дескрипторі. Батьківський `SWD\HidPosEmu\...` при цьому лишається здоровим, а
HID-інтерфейс не публікується взагалі. Саме щоб цього уникнути, дескриптор оголошує usage `0x03`;
якщо ти це бачиш — хтось повернув `0x02`. Здорова дочірня сутність має імʼя `HID-compliant device`
і клас `HIDClass`.

Клас **`HIDClass`** — тоді справді відмовився `EvtDeviceAdd` нашого драйвера, найчастіше через
властивості пристрою, які передає служба. Дивись розділ «Yellow bang» у
[`windows-runbook.md`](windows-runbook.md).

Логи драйвера видно через DebugView (рядки з префіксом `HidPosEmu:`), але **лише у Debug-збірці**:
`KdPrint` у Release компілюється в ніщо, тому порожній DebugView сам по собі не означає нічого.
Перезбирай через `.\installer\build.ps1 -Configuration Debug`. Службу можна запустити на передньому
плані:

```powershell
Stop-Service HidPosEmuSvc
& "$env:ProgramFiles\HidPosEmu\HidPosEmuSvc.exe" --console
```

### Служба не стартує: «An Application Control policy has blocked this file»

`Start-Service` падає, а в System-лозі подія 7000 з цим текстом. Це Smart App Control, і він блокує
бінарник скрізь, не лише як службу: `--selftest` із консолі впаде так само. Підтвердження:

```powershell
Get-WinEvent -LogName 'Microsoft-Windows-CodeIntegrity/Operational' -MaxEvents 20 |
  Where-Object { $_.Message -match 'HidPosEmu' } | Select-Object TimeCreated, Id, Message
```

Події 3033 і 3077 з іменем `HidPosEmuSvc.exe` не лишають сумнівів. Лікується лише вимкненням Smart
App Control, дивись розділ 0.

### Панель пише «Service: disconnected»

Служба не запущена або канал недоступний:

```powershell
Get-Service HidPosEmuSvc
Start-Service HidPosEmuSvc
Get-EventLog -LogName System -Newest 20 | Where-Object Source -match 'HidPosEmu|WUDFRd|Service Control Manager'
```

### Панель пише «driver not installed»

Пакет драйвера не в сховищі Windows. Перезапусти `install.ps1` від адміністратора і подивись код
виходу `pnputil` (значення пояснені в [`windows-runbook.md`](windows-runbook.md), розділ 7).

### Chrome не бачить пристрій

Це припущення значною мірою вже закрите. На реальній машині перелік інтерфейсів
`GUID_DEVINTERFACE_HID` тим самим шляхом, яким іде Chrome (`setupapi` плюс `hid.dll`), повертає
програмно створений пристрій нарівні зі справжніми: `NLS-HR22`, `0x1eab` / `0x3910`, серійник
`EMU-NEWLAND-0001`, usage page `0x8c`, usage `0x03`. Окремий процес відкрив цей інтерфейс і прочитав
із нього справжній скан. Тобто на рівні операційної системи пристрій нічим не відрізняється від
USB-сканера; неперевіреним лишається лише сам діалог вибору в Chrome.

Діагностика:

1. Відкрий `chrome://device-log`, натисни **Plug in** у панелі і подивись, чи зʼявляється рядок про
   доданий HID-пристрій.
2. Переконайся, що пристрій без помилки в Диспетчері пристроїв.
3. Перевір, що Chrome не запущений із профілем, де сайту вже відмовлено в доступі.

Якщо рядка в `device-log` немає взагалі — гіпотеза не підтвердилась, і це матеріал для окремої
розмови, а не для дрібного фікса.

### Скани доходять, але застосунок їх ігнорує

Порівняй те, що застосунок отримав, з текстом пресета. Якщо перший символ зайвий або бракує —
справа в байті довжини, дивись розділ 6 і `host/src/shared/framing.ts`.

---

## 10. Прибрати все

```powershell
C:\Tools\HidPosEmu\uninstall.ps1
```

Від адміністратора. Зупиняє і видаляє службу, виносить пакет драйвера з `pnputil`, чистить обидва
сховища сертифікатів і видаляє `%ProgramFiles%\HidPosEmu`.

Перевірка: `Get-Service HidPosEmuSvc` каже, що служби немає; `pnputil /enum-drivers` більше не згадує
`HidPosEmu`.
