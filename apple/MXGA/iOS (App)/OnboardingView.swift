import SwiftUI
import UIKit

struct OnboardingView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                OnboardingHeader()
                AvailabilityNotice()
                SetupSteps()
                PrivacySummary()
                OnboardingActions()
                OnboardingFooter()
            }
            .frame(maxWidth: 680, alignment: .leading)
            .padding(.horizontal, 20)
            .padding(.vertical, 28)
            .frame(maxWidth: .infinity)
        }
        .background(Color(uiColor: .systemBackground))
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
                    .font(.title.bold())
                Text("少看垃圾，多看人话。")
                    .font(.headline)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

private struct AvailabilityNotice: View {
    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: 4) {
                Text("仅在 Safari 中生效")
                    .font(.headline)
                Text("扩展可以处理 Safari 中打开的 x.com，但无法修改 X 原生 App 或其他 App 内置浏览器。")
                    .foregroundStyle(.secondary)
            }
        } icon: {
            Image(systemName: "safari.fill")
                .font(.title2)
                .foregroundStyle(.blue)
                .accessibilityHidden(true)
        }
        .padding(16)
        .background(.blue.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
    }
}

private struct SetupSteps: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("开始使用")
                .font(.title2.bold())
            SetupStep(number: 1, text: "打开“设置”→“App”→“Safari”→“扩展”。")
            SetupStep(number: 2, text: "启用 Make X Great Again，并允许访问 x.com。")
            SetupStep(number: 3, text: "回到 Safari 打开 x.com，扩展会在本地检查可见账号。")
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
                .frame(width: 26, height: 26)
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
        .background(.quaternary.opacity(0.45), in: RoundedRectangle(cornerRadius: 14))
    }
}

private struct OnboardingActions: View {
    @Environment(\.openURL) private var openURL

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) {
                SettingsButton(openURL: openURL)
                SafariButton()
            }
            VStack(spacing: 12) {
                SettingsButton(openURL: openURL)
                SafariButton()
            }
        }
    }
}

private struct SettingsButton: View {
    let openURL: OpenURLAction

    var body: some View {
        Button("打开设置", systemImage: "gear") {
            guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
            openURL(url)
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
    }
}

private struct SafariButton: View {
    var body: some View {
        Link(destination: URL(string: "https://x.com")!) {
            Label("在 Safari 中打开 X", systemImage: "safari")
        }
        .buttonStyle(.bordered)
        .controlSize(.large)
    }
}

private struct OnboardingFooter: View {
    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 16) {
                FooterLinks()
            }
            VStack(alignment: .leading, spacing: 10) {
                FooterLinks()
            }
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
    }
}

private struct FooterLinks: View {
    var body: some View {
        Link("隐私政策", destination: URL(string: "https://x.zuoluo.tv/privacy")!)
        Link("公共名单", destination: URL(string: "https://x.zuoluo.tv/list")!)
        Link("GitHub", destination: URL(string: "https://github.com/foru17/make-x-great-again")!)
    }
}
