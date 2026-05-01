import SwiftUI
import Foundation

@main
struct CursorMobileCompanionApp: App {
    @StateObject private var service = ServiceController()

    var body: some Scene {
        MenuBarExtra("Cursor Mobile", systemImage: service.isRunning ? "bolt.circle.fill" : "bolt.circle") {
            VStack(alignment: .leading, spacing: 10) {
                Text("Cursor Mobile")
                    .font(.headline)
                Text(service.status)
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Divider()

                Button(service.isRunning ? "Restart Service" : "Start Service") {
                    service.restart()
                }
                Button("Stop Service") {
                    service.stop()
                }
                .disabled(!service.isRunning)
                Button("Open Mobile UI") {
                    service.openUI()
                }
                Button("Copy URL") {
                    service.copyURL()
                }

                Divider()

                TextField("Repository path", text: $service.repoPath)
                    .frame(width: 320)
                TextField("HTTPS_PROXY", text: $service.httpsProxy)
                    .frame(width: 320)
                TextField("ALL_PROXY", text: $service.allProxy)
                    .frame(width: 320)

                Divider()

                Button("Quit") {
                    service.stop()
                    NSApplication.shared.terminate(nil)
                }
            }
            .padding()
        }
        .menuBarExtraStyle(.window)
    }
}

@MainActor
final class ServiceController: ObservableObject, @unchecked Sendable {
    @Published var repoPath: String = ProcessInfo.processInfo.environment["CODEX_MOBILE_ROOT"] ?? FileManager.default.currentDirectoryPath
    @Published var httpsProxy: String = ""
    @Published var allProxy: String = ""
    @Published var status: String = "Stopped"
    @Published var isRunning: Bool = false

    private var process: Process?
    private let port = ProcessInfo.processInfo.environment["CODEX_MOBILE_PORT"] ?? "8787"

    var url: String {
        let tailscale = tailscaleIP()
        return "http://\(tailscale ?? "127.0.0.1"):\(port)"
    }

    func restart() {
        stop()
        start()
    }

    func start() {
        let proc = Process()
        proc.currentDirectoryURL = URL(fileURLWithPath: repoPath)
        proc.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        proc.arguments = ["npm", "run", "start"]
        proc.environment = ProcessInfo.processInfo.environment.merging([
            "HTTPS_PROXY": httpsProxy,
            "ALL_PROXY": allProxy,
            "CODEX_MOBILE_BIND": "auto",
            "CODEX_MOBILE_PORT": port
        ]) { _, new in new }
        proc.terminationHandler = { [weak self] _ in
            Task { @MainActor in
                self?.isRunning = false
                self?.status = "Stopped"
            }
        }
        do {
            try proc.run()
            process = proc
            isRunning = true
            status = "Running at \(url)"
        } catch {
            status = error.localizedDescription
        }
    }

    func stop() {
        process?.terminate()
        process = nil
        isRunning = false
        status = "Stopped"
    }

    func openUI() {
        NSWorkspace.shared.open(URL(string: url)!)
    }

    func copyURL() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(url, forType: .string)
    }

    private func shell(_ command: String, _ args: [String]) -> String {
        let proc = Process()
        let pipe = Pipe()
        proc.executableURL = URL(fileURLWithPath: command)
        proc.arguments = args
        proc.standardOutput = pipe
        do {
            try proc.run()
            proc.waitUntilExit()
            return String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        } catch {
            return ""
        }
    }

    private func tailscaleIP() -> String? {
        let fromPath = shell("/usr/bin/env", ["tailscale", "ip", "-4"]).split(separator: "\n").first.map(String.init)
        if let fromPath, !fromPath.isEmpty {
            return fromPath
        }
        let appPath = "/Applications/Tailscale.app/Contents/MacOS/Tailscale"
        guard FileManager.default.isExecutableFile(atPath: appPath) else {
            return nil
        }
        return shell(appPath, ["ip", "-4"]).split(separator: "\n").first.map(String.init)
    }
}
