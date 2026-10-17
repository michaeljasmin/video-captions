// Captions.app : fenêtre Mac native qui démarre le serveur local et affiche l'interface.
// Compilée sur le Mac par scripts/build-app.sh (swiftc, sans Xcode).

import AppKit
import UniformTypeIdentifiers
import WebKit

/// Dossier du code (cloné depuis GitHub), écrit dans Info.plist au moment de la construction.
let appDir = (Bundle.main.object(forInfoDictionaryKey: "CaptionsAppDir") as? String) ?? NSHomeDirectory() + "/Captions"
let logPath = appDir + "/data/server.log"
let updateFlag = appDir + "/data/.install-update"  // mise à jour acceptée depuis le menu, à installer au lancement
let background = NSColor(red: 0.055, green: 0.063, blue: 0.075, alpha: 1)

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKUIDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    var window: NSWindow!
    var webView: WKWebView!
    var server: Process?
    var port = 8765
    var quitting = false
    var relaunchOnQuit = false

    // MARK: - Démarrage

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()

        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "captions")
        webView = WKWebView(frame: .zero, configuration: config)
        webView.uiDelegate = self
        webView.navigationDelegate = self
        webView.setValue(false, forKey: "drawsBackground") // pas de flash blanc au chargement

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1360, height: 880),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "Captions"
        window.backgroundColor = background
        window.minSize = NSSize(width: 960, height: 640)
        window.contentView = webView
        window.center()
        window.setFrameAutosaveName("CaptionsMain")
        window.delegate = self
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        // La page change à chaque mise à jour : on ne garde jamais d'ancienne copie en cache.
        WKWebsiteDataStore.default().removeData(
            ofTypes: [WKWebsiteDataTypeDiskCache, WKWebsiteDataTypeMemoryCache], modifiedSince: .distantPast) {}

        showLoading("Recherche de mises à jour…")
        DispatchQueue.global(qos: .userInitiated).async { self.startBackend() }
    }

    func startBackend() {
        let prepare = appDir + "/scripts/prepare.sh"

        // 1. Mise à jour disponible sur GitHub ? On propose, on n'impose pas.
        let check = runScript(prepare, ["check"])
        let lines = check.output.split(separator: "\n").map(String.init)
        let accepted = (try? FileManager.default.removeItem(atPath: updateFlag)) != nil
        if check.status == 0, lines.first == "UPDATE", lines.count >= 3,
           accepted || askForUpdate(current: lines[1], new: lines[2], changes: Array(lines.dropFirst(3))) {
            DispatchQueue.main.async { self.showLoading("Installation de la mise à jour…") }
            let update = runScript(prepare, ["update"])
            if update.status != 0 {
                return fail("La mise à jour a échoué.", details: update.output)
            }
            if update.output.contains("RELAUNCH") { return relaunch() }
        }

        // 2. Dépendances.
        let start = runScript(prepare, ["start"])
        if start.status != 0 {
            return fail("La préparation a échoué.", details: start.output)
        }

        // 2. Serveur local, enfant de l'app : il s'arrête quand on quitte.
        DispatchQueue.main.async { self.showLoading("Démarrage…") }
        port = (8765...8799).first(where: canBind) ?? 8765
        let process = Process()
        process.executableURL = URL(fileURLWithPath: appDir + "/.venv/bin/uvicorn")
        process.arguments = ["app.server:app", "--host", "127.0.0.1", "--port", String(port), "--log-level", "warning"]
        process.currentDirectoryURL = URL(fileURLWithPath: appDir)
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" // ffmpeg
        process.environment = env
        if let log = openLog() {
            process.standardOutput = log
            process.standardError = log
        }
        process.terminationHandler = { _ in
            if !self.quitting { self.fail("Le moteur de Captions s'est arrêté.", details: self.logTail()) }
        }
        do {
            try process.run()
        } catch {
            return fail("Impossible de lancer le moteur de Captions.", details: error.localizedDescription)
        }
        server = process

        // 3. Affiche l'interface dès que le serveur répond.
        let url = URL(string: "http://127.0.0.1:\(port)/")!
        for _ in 0..<120 {
            if !process.isRunning { return }
            if let data = try? Data(contentsOf: url.appendingPathComponent("api/ping")),
               String(decoding: data, as: UTF8.self).contains("captions") {
                DispatchQueue.main.async { self.webView.load(URLRequest(url: url)) }
                return
            }
            usleep(500_000)
        }
        fail("Le moteur de Captions n'a pas démarré.", details: logTail())
    }

    /// Fenêtre « Mise à jour disponible » (appelée hors du fil principal : on attend la réponse).
    func askForUpdate(current: String, new: String, changes: [String]) -> Bool {
        var accepted = false
        DispatchQueue.main.sync {
            let alert = NSAlert()
            alert.messageText = "Mise à jour disponible : version \(new)"
            let list = changes.map { "• \($0)" }.joined(separator: "\n")
            alert.informativeText = "Tu as la version \(current).\n\nNouveautés :\n\(list)"
            alert.addButton(withTitle: "Mettre à jour")
            alert.addButton(withTitle: "Plus tard")
            accepted = alert.runModal() == .alertFirstButtonReturn
        }
        return accepted
    }

    /// L'app elle-même a changé : on ouvre la nouvelle version et on ferme celle-ci.
    func relaunch() {
        DispatchQueue.main.async {
            self.quitting = true
            self.relaunchOnQuit = true
            NSApp.terminate(nil)
        }
    }

    func showLoading(_ status: String) {
        let html = """
        <html><body style="margin:0;height:100vh;display:grid;place-items:center;background:#0e1013;
        color:#e8eaed;font:15px -apple-system,system-ui;-webkit-user-select:none">
        <div style="text-align:center"><div style="width:34px;height:34px;margin:0 auto 18px;border:3px solid #262a31;
        border-top-color:#4f8cff;border-radius:50%;animation:s .8s linear infinite"></div>
        <div style="font-weight:600;font-size:18px;margin-bottom:6px">Captions</div>
        <div style="color:#8b93a0">\(status)</div></div>
        <style>@keyframes s{to{transform:rotate(360deg)}}</style></body></html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }

    func fail(_ message: String, details: String) {
        DispatchQueue.main.async {
            guard !self.quitting else { return }
            self.quitting = true
            let alert = NSAlert()
            alert.alertStyle = .critical
            alert.messageText = message
            alert.informativeText = String(details.suffix(1500)).trimmingCharacters(in: .whitespacesAndNewlines)
            alert.addButton(withTitle: "Quitter")
            alert.runModal()
            NSApp.terminate(nil)
        }
    }

    // MARK: - Arrêt

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    // Le bouton rouge passe par la même vérification que ⌘Q (modifications non enregistrées, travail en cours).
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        NSApp.terminate(nil)
        return false
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if quitting { return .terminateNow }
        let js = "[window.hasUnsavedChanges ? window.hasUnsavedChanges() : false, window.unsavedProjectName ? window.unsavedProjectName() : '']"
        webView.evaluateJavaScript(js) { result, _ in
            let values = result as? [Any] ?? []
            let dirty = values.first as? Bool ?? false
            let name = values.count > 1 ? values[1] as? String ?? "" : ""
            guard dirty else { return self.confirmBusyThenQuit() }

            let alert = NSAlert()
            alert.messageText = "Enregistrer les modifications apportées à « \(name) » ?"
            alert.informativeText = "Elles seront perdues si tu ne les enregistres pas."
            alert.addButton(withTitle: "Enregistrer")
            alert.addButton(withTitle: "Annuler")
            alert.addButton(withTitle: "Ne pas enregistrer")
            switch alert.runModal() {
            case .alertFirstButtonReturn:
                self.webView.callAsyncJavaScript("return await window.saveNow()", arguments: [:], in: nil, in: .page) { saved in
                    if case .success(let ok) = saved, ok as? Bool == true {
                        self.confirmBusyThenQuit()
                    } else {
                        self.cancelQuit()
                    }
                }
            case .alertThirdButtonReturn:
                self.confirmBusyThenQuit()
            default:
                self.cancelQuit()
            }
        }
        return .terminateLater
    }

    func cancelQuit() {
        relaunchOnQuit = false
        try? FileManager.default.removeItem(atPath: updateFlag)
        NSApp.reply(toApplicationShouldTerminate: false)
    }

    func confirmBusyThenQuit() {
        guard let data = try? Data(contentsOf: URL(string: "http://127.0.0.1:\(port)/api/busy")!),
              String(decoding: data, as: UTF8.self).contains("true") else {
            return NSApp.reply(toApplicationShouldTerminate: true)
        }
        let alert = NSAlert()
        alert.messageText = "Une transcription ou un export est en cours."
        alert.informativeText = "Si tu quittes maintenant, il sera interrompu."
        alert.addButton(withTitle: "Continuer le travail")
        alert.addButton(withTitle: "Quitter quand même")
        if alert.runModal() == .alertSecondButtonReturn {
            NSApp.reply(toApplicationShouldTerminate: true)
        } else {
            cancelQuit()
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        quitting = true
        if let server, server.isRunning {
            server.terminate()
            let deadline = Date().addingTimeInterval(3)
            while server.isRunning && Date() < deadline { usleep(50_000) }
            if server.isRunning { kill(server.processIdentifier, SIGKILL) }
        }
        if relaunchOnQuit { openNewInstance() }
    }

    func openNewInstance() {
        let open = Process()
        open.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        open.arguments = ["-n", Bundle.main.bundlePath]
        try? open.run()
    }

    // MARK: - Pont avec la page (Enregistrer sous…)

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        if type == "save", let path = body["path"] as? String, let name = body["name"] as? String {
            saveExport(from: URL(fileURLWithPath: path), suggestedName: name)
        }
    }

    func saveExport(from source: URL, suggestedName: String) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedName
        panel.canCreateDirectories = true
        if let type = UTType(filenameExtension: source.pathExtension) { panel.allowedContentTypes = [type] }
        panel.beginSheetModal(for: window) { response in
            guard response == .OK, let dest = panel.url else { return }
            self.callPage("nativeSaveStarted")
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    try? FileManager.default.removeItem(at: dest)
                    try FileManager.default.copyItem(at: source, to: dest)
                    DispatchQueue.main.async {
                        self.callPage("nativeSaved", dest.path)
                        NSWorkspace.shared.activateFileViewerSelecting([dest])
                    }
                } catch {
                    DispatchQueue.main.async {
                        self.callPage("nativeSaveFailed", error.localizedDescription)
                    }
                }
            }
        }
    }

    func callPage(_ function: String, _ argument: String = "") {
        let arg = (try? String(data: JSONSerialization.data(withJSONObject: [argument]), encoding: .utf8)) ?? "[\"\"]"
        webView.evaluateJavaScript("window.\(function) && window.\(function)(...\(arg))")
    }

    // MARK: - Comportements navigateur à fournir soi-même dans une WKWebView

    // <input type="file">
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = false
        panel.allowedContentTypes = [.movie, .video, .mpeg4Movie, .quickTimeMovie]
        panel.beginSheetModal(for: window) { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }

    // confirm()
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "Continuer")
        alert.addButton(withTitle: "Annuler")
        alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
    }

    // alert()
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }

    // Reste sur l'app : un fichier lâché à côté de la zone ne remplace pas la page, les liens externes vont au navigateur.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        if url.scheme == "about" || url.host == "127.0.0.1" { return decisionHandler(.allow) }
        if url.scheme == "http" || url.scheme == "https" { NSWorkspace.shared.open(url) }
        decisionHandler(.cancel)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    // MARK: - Menus (indispensables pour ⌘C / ⌘V / ⌘A dans les champs texte)

    func buildMenu() {
        let main = NSMenu()

        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "À propos de Captions", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(withTitle: "Rechercher des mises à jour…", action: #selector(checkForUpdates), keyEquivalent: "").target = self
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Masquer Captions", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "Quitter Captions", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        main.addItem(submenu: appMenu, title: "Captions")

        let edit = NSMenu(title: "Édition")
        edit.addItem(withTitle: "Annuler", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = edit.addItem(withTitle: "Rétablir", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(.separator())
        edit.addItem(withTitle: "Couper", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copier", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Coller", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Tout sélectionner", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        main.addItem(submenu: edit, title: "Édition")

        let view = NSMenu(title: "Présentation")
        view.addItem(withTitle: "Recharger la page", action: #selector(reloadPage), keyEquivalent: "r").target = self
        view.addItem(withTitle: "Plein écran", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
            .keyEquivalentModifierMask = [.command, .control]
        main.addItem(submenu: view, title: "Présentation")

        let windowMenu = NSMenu(title: "Fenêtre")
        windowMenu.addItem(withTitle: "Réduire", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Fermer", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        main.addItem(submenu: windowMenu, title: "Fenêtre")
        NSApp.windowsMenu = windowMenu

        NSApp.mainMenu = main
    }

    @objc func reloadPage() { webView.reload() }

    /// Menu Captions › Rechercher des mises à jour…
    @objc func checkForUpdates() {
        DispatchQueue.global(qos: .userInitiated).async {
            let check = self.runScript(appDir + "/scripts/prepare.sh", ["check"])
            let lines = check.output.split(separator: "\n").map(String.init)
            guard lines.first == "UPDATE", lines.count >= 3 else {
                return DispatchQueue.main.async {
                    let alert = NSAlert()
                    alert.messageText = "Captions est à jour."
                    alert.runModal()
                }
            }
            guard self.askForUpdate(current: lines[1], new: lines[2], changes: Array(lines.dropFirst(3))) else { return }
            // On quitte normalement (« Enregistrer les modifications ? » compris), puis la nouvelle ouverture
            // installe la mise à jour sans redemander.
            DispatchQueue.main.async {
                FileManager.default.createFile(atPath: updateFlag, contents: nil)
                self.relaunchOnQuit = true
                NSApp.terminate(nil)
            }
        }
    }

    // MARK: - Utilitaires

    func runScript(_ path: String, _ args: [String] = []) -> (status: Int32, output: String) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = [path] + args
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        do { try process.run() } catch { return (1, error.localizedDescription) }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return (process.terminationStatus, String(decoding: data, as: UTF8.self))
    }

    func openLog() -> FileHandle? {
        try? FileManager.default.createDirectory(atPath: appDir + "/data", withIntermediateDirectories: true)
        if !FileManager.default.fileExists(atPath: logPath) {
            FileManager.default.createFile(atPath: logPath, contents: nil)
        }
        let handle = FileHandle(forWritingAtPath: logPath)
        handle?.seekToEndOfFile()
        handle?.write("--- \(Date()) démarrage (port \(port))\n".data(using: .utf8)!)
        return handle
    }

    func logTail() -> String {
        let text = (try? String(contentsOfFile: logPath, encoding: .utf8)) ?? ""
        return text.split(separator: "\n").suffix(8).joined(separator: "\n")
    }

    func canBind(_ port: Int) -> Bool {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { return false }
        defer { close(fd) }
        // Comme uvicorn : un port tout juste libéré (TIME_WAIT) reste utilisable. On garde ainsi le même
        // port d'un lancement à l'autre, donc la même origine web, donc les réglages mémorisés.
        var yes: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout<Int32>.size))
        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = in_port_t(UInt16(port).bigEndian)
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")
        return withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) == 0
            }
        }
    }
}

extension NSMenu {
    func addItem(submenu: NSMenu, title: String) {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.submenu = submenu
        addItem(item)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
