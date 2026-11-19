import SwiftUI
import WidgetKit
import BestCardEngine
import CardPickerCore

/// Lock screen widget: "Which card here?". Shows the latest place-based answer
/// (saved place arrival, nearby pick, Siri) from the App Group snapshot, the
/// same Answer text the app shows. Tapping opens the app's Here sheet.
struct HereEntry: TimelineEntry {
    let date: Date
    let answer: LastAnswer?
}

struct HereProvider: TimelineProvider {
    /// Answers older than this are treated as stale (you've probably left).
    static let freshFor: TimeInterval = 2 * 60 * 60

    func placeholder(in context: Context) -> HereEntry {
        HereEntry(date: .now, answer: LastAnswer(placeName: "Trader Joe's", cardName: "Amex Gold", shortCode: "GOLD",
                                                 rateText: "4x", centsText: "8.0", reason: "4x at US supermarkets", date: .now))
    }

    func getSnapshot(in context: Context, completion: @escaping (HereEntry) -> Void) {
        completion(context.isPreview ? placeholder(in: context) : current())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<HereEntry>) -> Void) {
        let entry = current()
        var entries = [entry]
        if let a = entry.answer {
            // Drop to the "tap to check" state once the answer goes stale.
            entries.append(HereEntry(date: a.date.addingTimeInterval(Self.freshFor), answer: nil))
        }
        completion(Timeline(entries: entries, policy: .never))
    }

    private func current() -> HereEntry {
        let a = SnapshotStore().load()?.lastAnswer
        let fresh = a.flatMap { Date().timeIntervalSince($0.date) < Self.freshFor ? $0 : nil }
        return HereEntry(date: .now, answer: fresh)
    }
}

struct HereWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: HereEntry

    var body: some View {
        switch family {
        case .accessoryInline:
            if let a = entry.answer { Text("\(a.cardName) · \(a.rateText)") } else { Text("Which card here?") }
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Image(systemName: "creditcard.fill").font(.caption2)
                    Text(entry.answer?.shortCode ?? "?").font(.caption.bold()).minimumScaleFactor(0.6)
                }
            }
        default:
            if let a = entry.answer {
                VStack(alignment: .leading, spacing: 1) {
                    Text(a.placeName).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                    Text(a.cardName).font(.headline).lineLimit(1).minimumScaleFactor(0.7)
                    Text("\(a.rateText) · \(a.centsText)¢ per $").font(.caption)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                VStack(alignment: .leading, spacing: 2) {
                    Label("Which card here?", systemImage: "creditcard").font(.headline)
                    Text("Tap to check").font(.caption).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}

struct HereWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Shared.widgetKind, provider: HereProvider()) { entry in
            HereWidgetView(entry: entry)
                .widgetURL(Shared.hereURL)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Which card here?")
        .description("The best card for the place you're at.")
        .supportedFamilies([.accessoryRectangular, .accessoryInline, .accessoryCircular, .systemSmall])
    }
}

/// Control Center (iOS 18+): opens the app's "Which card here?" sheet.
@available(iOS 18.0, *)
struct WhichCardControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Shared.controlKind) {
            ControlWidgetButton(action: OpenHereIntent()) {
                Label("Which card here?", systemImage: "creditcard")
            }
        }
        .displayName("Which card here?")
        .description("Open Card Picker and check this place.")
    }
}

@main
struct BestCardWidgetBundle: WidgetBundle {
    var body: some Widget {
        HereWidget()
        if #available(iOS 18.0, *) {
            WhichCardControl()
        }
    }
}
