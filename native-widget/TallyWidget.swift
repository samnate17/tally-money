import WidgetKit
import SwiftUI

// Reads the summary the Tally Money app writes to
//   ~/Library/Application Support/Tally Money/native-widget.json
// The extension is sandboxed; its entitlements allow read-only access to that one folder.

struct Net: Codable { var net: Double; var assets: Double; var debts: Double }
struct Spend: Codable { var income: Double; var spent: Double; var budgeted: Double; var budgetSpent: Double; var left: Double; var perDay: Double }
struct Over: Codable { var cat: String; var spent: Double; var budget: Double }
struct Bill: Codable { var name: String; var amount: Double; var days: Int }
struct Goal: Codable { var name: String; var pct: Int }

struct Summary: Codable {
    var sample: Bool
    var month: String
    var daysLeft: Int
    var net: Net?
    var spend: Spend
    var over: [Over]
    var bills: [Bill]
    var goal: Goal?
    var hideAmounts: Bool?
    var updatedAt: String?
}

func realHome() -> String {
    if let pw = getpwuid(getuid()), let dir = pw.pointee.pw_dir { return String(cString: dir) }
    return NSHomeDirectory()
}

func loadSummary() -> Summary? {
    let path = realHome() + "/Library/Application Support/Tally Money/native-widget.json"
    guard let data = FileManager.default.contents(atPath: path) else { return nil }
    return try? JSONDecoder().decode(Summary.self, from: data)
}

func money(_ v: Double) -> String {
    let f = NumberFormatter()
    f.numberStyle = .currency
    f.currencyCode = "USD"
    f.maximumFractionDigits = 0
    return f.string(from: NSNumber(value: v.rounded())) ?? "$0"
}

struct SummaryEntry: TimelineEntry {
    let date: Date
    let summary: Summary?
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> SummaryEntry {
        SummaryEntry(date: Date(), summary: Summary(
            sample: true, month: "This month", daysLeft: 15,
            net: Net(net: 12400, assets: 15200, debts: 2800),
            spend: Spend(income: 4200, spent: 1800, budgeted: 2400, budgetSpent: 1800, left: 600, perDay: 40),
            over: [], bills: [Bill(name: "Rent", amount: 1400, days: 3)], goal: Goal(name: "Trip", pct: 40),
            hideAmounts: false, updatedAt: nil))
    }
    func getSnapshot(in context: Context, completion: @escaping (SummaryEntry) -> Void) {
        completion(loadSummary().map { SummaryEntry(date: Date(), summary: $0) } ?? placeholder(in: context))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<SummaryEntry>) -> Void) {
        let entry = SummaryEntry(date: Date(), summary: loadSummary())
        completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(15 * 60))))
    }
}

struct Amount: View {
    let value: Double
    let hide: Bool
    var body: some View { Text(hide ? "•••••" : money(value)) }
}

struct BudgetBar: View {
    let spent: Double
    let total: Double
    var body: some View {
        let p = total > 0 ? min(1, spent / total) : 0
        let tint: Color = spent > total ? .red : (p > 0.85 ? .orange : .accentColor)
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.secondary.opacity(0.25))
                Capsule().fill(tint).frame(width: g.size.width * p)
            }
        }
        .frame(height: 6)
    }
}

struct TallyWidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: SummaryEntry

    var body: some View {
        if let s = entry.summary {
            content(s)
        } else {
            VStack(spacing: 6) {
                Image(systemName: "chart.bar.fill").font(.title2).foregroundStyle(.secondary)
                Text("Open Tally Money once to fill this in.").font(.caption).multilineTextAlignment(.center).foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    func content(_ s: Summary) -> some View {
        let hide = s.hideAmounts ?? false
        VStack(alignment: .leading, spacing: 8) {
            Text(s.sample ? "Tally · example data" : "Tally · \(s.month)")
                .font(.caption2).textCase(.uppercase).foregroundStyle(.secondary)
            if let n = s.net {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Net worth").font(.caption).foregroundStyle(.secondary)
                    Amount(value: n.net, hide: hide)
                        .font(.system(size: family == .systemSmall ? 24 : 30, weight: .bold, design: .rounded))
                        .foregroundStyle(n.net < 0 ? Color.red : Color.primary)
                        .minimumScaleFactor(0.6).lineLimit(1)
                }
            }
            if s.spend.budgeted > 0 {
                VStack(alignment: .leading, spacing: 3) {
                    HStack {
                        Text("Budgets").font(.caption).foregroundStyle(.secondary)
                        Spacer()
                        if s.spend.left < 0 {
                            HStack(spacing: 3) { Amount(value: -s.spend.left, hide: hide); Text("over") }
                                .font(.caption).foregroundStyle(.red)
                        } else {
                            HStack(spacing: 3) { Amount(value: s.spend.left, hide: hide); Text("left") }
                                .font(.caption).foregroundStyle(.green)
                        }
                    }
                    BudgetBar(spent: s.spend.budgetSpent, total: s.spend.budgeted)
                    if family != .systemSmall && s.spend.left > 0 && s.daysLeft > 0 {
                        HStack(spacing: 3) { Text("About"); Amount(value: s.spend.perDay, hide: hide); Text("a day for \(s.daysLeft) more days") }
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                }
            } else {
                HStack { Text("Spent").font(.caption).foregroundStyle(.secondary); Spacer(); Amount(value: s.spend.spent, hide: hide).font(.caption) }
            }
            if family != .systemSmall {
                if !s.over.isEmpty && family == .systemLarge {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Over budget").font(.caption2).textCase(.uppercase).foregroundStyle(.secondary)
                        ForEach(s.over.indices, id: \.self) { i in
                            HStack {
                                Text(s.over[i].cat).font(.caption)
                                Spacer()
                                HStack(spacing: 3) { Amount(value: s.over[i].spent - s.over[i].budget, hide: hide); Text("over") }
                                    .font(.caption).foregroundStyle(.red)
                            }
                        }
                    }
                }
                if !s.bills.isEmpty {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Due soon").font(.caption2).textCase(.uppercase).foregroundStyle(.secondary)
                        ForEach(s.bills.prefix(family == .systemLarge ? 4 : 2).indices, id: \.self) { i in
                            let b = s.bills[i]
                            HStack {
                                Text(b.name).font(.caption).lineLimit(1)
                                Text(b.days <= 0 ? "today" : (b.days == 1 ? "tomorrow" : "in \(b.days) days")).font(.caption2).foregroundStyle(.secondary)
                                Spacer()
                                Amount(value: b.amount, hide: hide).font(.caption)
                            }
                        }
                    }
                }
                if family == .systemLarge, let g = s.goal {
                    VStack(alignment: .leading, spacing: 3) {
                        HStack { Text(g.name).font(.caption); Spacer(); Text("\(g.pct)%").font(.caption) }
                        BudgetBar(spent: Double(g.pct), total: 100)
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct TallyWidget: Widget {
    let kind = "TallyWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            TallyWidgetView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Tally Money")
        .description("Net worth, budget progress and bills due soon.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

@main
struct TallyWidgetBundle: WidgetBundle {
    var body: some Widget { TallyWidget() }
}
