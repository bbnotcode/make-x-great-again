import SafariServices
import SwiftUI

nonisolated private var safariExtensionBundleIdentifier: String {
    let appBundleIdentifier = Bundle.main.bundleIdentifier ?? "tv.zuoluo.mxga"
    return "\(appBundleIdentifier).SafariExtension"
}

nonisolated private enum ExtensionStatus: Equatable, Sendable {
    case checking
    case enabled
    case disabled
    case unavailable(String)
}

nonisolated private enum SafariExtensionBridge {
    @concurrent
    nonisolated static func currentStatus() async -> ExtensionStatus {
        await withCheckedContinuation { continuation in
            // SafariServices replies on its XPC queue. Explicit @Sendable keeps
            // this callback nonisolated instead of inheriting MainActor.
            let completion: @Sendable (SFSafariExtensionState?, (any Error)?) -> Void = { state, error in
                if let error {
                    let nsError = error as NSError
                    let diagnostic = "\(nsError.domain) (\(nsError.code)): \(nsError.localizedDescription)"
                    continuation.resume(returning: .unavailable(diagnostic))
                } else {
                    continuation.resume(returning: state?.isEnabled == true ? .enabled : .disabled)
                }
            }
            SFSafariExtensionManager.getStateOfSafariExtension(
                withIdentifier: safariExtensionBundleIdentifier,
                completionHandler: completion
            )
        }
    }

    static func openPreferences() {
        SFSafariApplication.showPreferencesForExtension(
            withIdentifier: safariExtensionBundleIdentifier
        ) { _ in }
    }
}

struct OnboardingView: View {
    @State private var status: ExtensionStatus = .checking

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                OnboardingHeader()
                ExtensionStatusCard(status: status)
                SetupSteps()
                PrivacySummary()
                OnboardingActions(
                    status: status,
                    openPreferences: SafariExtensionBridge.openPreferences,
                    refresh: refresh
                )
                OnboardingFooter()
            }
            .padding(32)
        }
        .frame(width: 640)
        .task {
            await refresh()
        }
    }

    private func refresh() async {
        status = await SafariExtensionBridge.currentStatus()
    }
}

private struct OnboardingHeader: View {
    var body: some View {
        HStack(spacing: 16) {
            Image(systemName: "shield.lefthalf.filled")
                .font(.largeTitle)
                .foregroundStyle(.white)
                .frame(width: 64, height: 64)
                .background(.blue.gradient, in: RoundedRectangle(cornerRadius: 16))
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                Text("Make X Great Again")
                    .font(.largeTitle.bold())
                Text("少看垃圾，多看人话。")
                    .font(.title3)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

private struct ExtensionStatusCard: View {
    let status: ExtensionStatus

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: iconName)
                .font(.title2)
                .foregroundStyle(iconColor)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.headline)
                Text(detail)
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 16)

            if status == .checking {
                ProgressView()
                    .controlSize(.small)
            }
        }
        .padding(16)
        .background(.quaternary.opacity(0.45), in: RoundedRectangle(cornerRadius: 14))
    }

    private var iconName: String {
        switch status {
        case .checking: "clock"
        case .enabled: "checkmark.circle.fill"
        case .disabled: "exclamationmark.circle.fill"
        case .unavailable: "xmark.circle.fill"
        }
    }

    private var iconColor: Color {
        switch status {
        case .checking: .secondary
        case .enabled: .green
        case .disabled: .orange
        case .unavailable: .red
        }
    }

    private var title: LocalizedStringResource {
        switch status {
        case .checking: "正在检查 Safari 扩展…"
        case .enabled: "Safari 扩展已启用"
        case .disabled: "Safari 扩展尚未启用"
        case .unavailable: "无法读取扩展状态"
        }
    }

    private var detail: LocalizedStringResource {
        switch status {
        case .checking: "请稍候。"
        case .enabled: "打开 x.com 后，小蓝会自动在本地检查可见账号。"
        case .disabled: "请在 Safari 设置中启用 Make X Great Again。"
        case let .unavailable(diagnostic):
            "SafariServices 返回：\(diagnostic)"
        }
    }
}

private struct SetupSteps: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("开始使用")
                .font(.title2.bold())
            SetupStep(number: 1, text: "在 Safari 设置的“扩展”中启用 Make X Great Again。")
            SetupStep(number: 2, text: "访问 x.com，并允许扩展读取和修改该网站。")
            SetupStep(number: 3, text: "照常浏览；命中本地名单时会出现徽标和处理按钮。")
        }
    }
}

private struct SetupStep: View {
    let number: Int
    let text: LocalizedStringResource

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(number, format: .number)
                .font(.caption.bold())
                .foregroundStyle(.white)
                .frame(width: 24, height: 24)
                .background(.blue, in: Circle())
            Text(text)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct PrivacySummary: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("本地优先", systemImage: "lock.shield")
                .font(.headline)
            Text("检测、匹配、处理记录和统计均保存在本机。只有在你主动选择 X 静音或拉黑后，扩展才会使用当前登录态直连 X 执行动作；请求不经过 MXGA 服务器。")
                .foregroundStyle(.secondary)
        }
        .padding(16)
        .background(.blue.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
    }
}

private struct OnboardingActions: View {
    let status: ExtensionStatus
    let openPreferences: () -> Void
    let refresh: () async -> Void

    var body: some View {
        ViewThatFits {
            HStack(spacing: 12) {
                actionButtons
            }
            VStack(spacing: 12) {
                actionButtons
            }
        }
    }

    @ViewBuilder
    private var actionButtons: some View {
        Button("打开 Safari 扩展设置", systemImage: "safari", action: openPreferences)
            .buttonStyle(.borderedProminent)
            .controlSize(.large)

        Button("重新检查", systemImage: "arrow.clockwise") {
            Task { await refresh() }
        }
        .buttonStyle(.bordered)
        .controlSize(.large)
        .disabled(status == .checking)
    }
}

private struct OnboardingFooter: View {
    var body: some View {
        HStack(spacing: 16) {
            Link("隐私政策", destination: URL(string: "https://x.zuoluo.tv/privacy")!)
            Link("公共名单", destination: URL(string: "https://x.zuoluo.tv/list")!)
            Link("GitHub", destination: URL(string: "https://github.com/foru17/make-x-great-again")!)
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
    }
}
