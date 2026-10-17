import WidgetKit
import SwiftUI

// Reads the summary the Tally Money app writes to
//   ~/Library/Application Support/Tally Money/native-widget.json
// The extension is sandboxed; its entitlements allow read-only access to that one folder.

struct Net: Codable { var net: Double; var assets: Double; var debts: Double; var spark: [Double]? }
struct Spend: Codable { var income: Double; var spent: Double; var budgeted: Double; var budgetSpent: Double; var left: Double; var perDay: Double; var cats: [CatAmt]? }
struct CatAmt: Codable { var cat: String; var amt: Double }
struct Over: Codable { var cat: String; var spent: Double; var budget: Double }
struct Bill: Codable { var name: String; var amount: Double; var days: Int }
struct Goal: Codable { var name: String; var pct: Int }
struct Mover: Codable { var sym: String; var pct: Double }
struct Invest: Codable { var value: Double; var dayChg: Double; var dayPct: Double?; var gain: Double; var gainPct: Double?; var top: [Mover]?; var spark: [Double]? }
struct PayNext: Codable { var days: Int; var net: Double; var job: String?; var cycle: Int? }
struct SubsInfo: Codable { var monthly: Double; var count: Int }
struct DebtInfo: Codable { var total: Double; var monthly: Double }
struct CreditInfo: Codable { var score: Int; var diff: Int? }

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
    // Set by the app: which sections to show and in what order, plus the numbers for the newer sections.
    var sections: [String]?
    var invest: Invest?
    var pay: PayNext?
    var subs: SubsInfo?
    var debt: DebtInfo?
    var credit: CreditInfo?
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

func pctText(_ v: Double) -> String {
    return String(format: "%+.1f%%", v)
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

// A small line graph with a soft fill, drawn from a list of values.
struct Sparkline: View {
    let values: [Double]
    let tint: Color
    var body: some View {
        GeometryReader { g in
            let lo: Double = values.min() ?? 0
            let hi: Double = values.max() ?? 1
            let span: Double = max(hi - lo, 0.0001)
            let steps: Int = max(values.count - 1, 1)
            let pts: [CGPoint] = values.enumerated().map { pair in
                CGPoint(x: g.size.width * CGFloat(pair.offset) / CGFloat(steps),
                        y: g.size.height * (1 - CGFloat((pair.element - lo) / span)))
            }
            ZStack {
                Path { p in
                    guard let first = pts.first else { return }
                    p.move(to: CGPoint(x: first.x, y: g.size.height))
                    for pt in pts { p.addLine(to: pt) }
                    p.addLine(to: CGPoint(x: g.size.width, y: g.size.height))
                    p.closeSubpath()
                }
                .fill(tint.opacity(0.18))
                Path { p in
                    guard let first = pts.first else { return }
                    p.move(to: first)
                    for pt in pts.dropFirst() { p.addLine(to: pt) }
                }
                .stroke(tint, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
            }
        }
    }
}

// A ring that fills to a fraction between 0 and 1.
struct Ring: View {
    let fraction: Double
    let tint: Color
    var body: some View {
        ZStack {
            Circle().stroke(Color.secondary.opacity(0.25), lineWidth: 6)
            Circle()
                .trim(from: 0, to: CGFloat(min(max(fraction, 0), 1)))
                .stroke(tint, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
    }
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
                Text("Open Agent X once to fill this in.").font(.caption).multilineTextAlignment(.center).foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    func content(_ s: Summary) -> some View {
        let hide = s.hideAmounts ?? false
        let order = s.sections ?? ["networth", "budgets", "bills", "goal"]
        let limit = family == .systemSmall ? 2 : (family == .systemMedium ? 3 : 6)
        VStack(alignment: .leading, spacing: 8) {
            Text(s.sample ? "Agent X · example data" : "Agent X · \(s.month)")
                .font(.caption2).textCase(.uppercase).foregroundStyle(.secondary)
            ForEach(Array(order.prefix(limit)), id: \.self) { id in
                section(id, s, hide)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    func section(_ id: String, _ s: Summary, _ hide: Bool) -> some View {
        switch id {
        case "networth": netSection(s, hide)
        case "invest": investSection(s, hide)
        case "budgets": budgetSection(s, hide)
        case "bills": billsSection(s, hide)
        case "paycheck": paySection(s, hide)
        case "spending": spendingSection(s, hide)
        case "goal": goalSection(s)
        case "debts": debtSection(s, hide)
        case "subs": subsSection(s, hide)
        case "credit": creditSection(s)
        default: EmptyView()
        }
    }

    @ViewBuilder
    func netSection(_ s: Summary, _ hide: Bool) -> some View {
        if let n = s.net {
            VStack(alignment: .leading, spacing: 0) {
                Text("Net worth").font(.caption).foregroundStyle(.secondary)
                Amount(value: n.net, hide: hide)
                    .font(.system(size: family == .systemSmall ? 24 : 30, weight: .bold, design: .rounded))
                    .foregroundStyle(n.net < 0 ? Color.red : Color.primary)
                    .minimumScaleFactor(0.6).lineLimit(1)
                if let sp = n.spark, sp.count > 1, family != .systemSmall {
                    Sparkline(values: sp, tint: (sp.last ?? 0) >= (sp.first ?? 0) ? Color.green : Color.red)
                        .frame(height: 30)
                        .padding(.top, 4)
                }
            }
        }
    }

    @ViewBuilder
    func investSection(_ s: Summary, _ hide: Bool) -> some View {
        if let v = s.invest {
            let up = v.dayChg >= 0
            VStack(alignment: .leading, spacing: 2) {
                Text("Investments").font(.caption).foregroundStyle(.secondary)
                HStack {
                    Amount(value: v.value, hide: hide)
                        .font(.system(size: 20, weight: .bold, design: .rounded))
                        .minimumScaleFactor(0.6).lineLimit(1)
                    Spacer()
                    HStack(spacing: 3) {
                        Text(up ? "▲" : "▼")
                        Amount(value: abs(v.dayChg), hide: hide)
                        if let p = v.dayPct { Text("(" + pctText(p) + ")") }
                    }
                    .font(.caption).foregroundStyle(up ? Color.green : Color.red)
                }
                if let sp = v.spark, sp.count > 1, family != .systemSmall {
                    Sparkline(values: sp, tint: (sp.last ?? 0) >= (sp.first ?? 0) ? Color.green : Color.red)
                        .frame(height: 28)
                }
                if family != .systemSmall, let t = v.top, !t.isEmpty {
                    ForEach(Array(t.prefix(family == .systemLarge ? 3 : 2)), id: \.sym) { m in
                        HStack {
                            Text(m.sym).font(.caption)
                            Spacer()
                            Text(pctText(m.pct)).font(.caption).foregroundStyle(m.pct >= 0 ? Color.green : Color.red)
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    func budgetSection(_ s: Summary, _ hide: Bool) -> some View {
        if s.spend.budgeted > 0 {
            VStack(alignment: .leading, spacing: 3) {
                if family != .systemSmall {
                    HStack(spacing: 10) {
                        Ring(fraction: s.spend.budgetSpent / s.spend.budgeted,
                             tint: s.spend.budgetSpent > s.spend.budgeted ? Color.red : Color.accentColor)
                            .frame(width: 34, height: 34)
                        Text("\(Int((s.spend.budgetSpent / s.spend.budgeted * 100).rounded()))% of your budgets used")
                            .font(.caption)
                    }
                }
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
                if family == .systemLarge && !s.over.isEmpty {
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
        } else {
            HStack { Text("Spent").font(.caption).foregroundStyle(.secondary); Spacer(); Amount(value: s.spend.spent, hide: hide).font(.caption) }
        }
    }

    @ViewBuilder
    func billsSection(_ s: Summary, _ hide: Bool) -> some View {
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
    }

    @ViewBuilder
    func paySection(_ s: Summary, _ hide: Bool) -> some View {
        if let p = s.pay {
            VStack(alignment: .leading, spacing: 2) {
                Text("Next paycheck").font(.caption2).textCase(.uppercase).foregroundStyle(.secondary)
                if family != .systemSmall {
                    Ring(fraction: 1 - Double(max(p.days, 0)) / Double(max(p.cycle ?? 14, 1)), tint: Color.green)
                        .frame(width: 30, height: 30)
                }
                HStack {
                    Text(p.days <= 0 ? "Today" : (p.days == 1 ? "Tomorrow" : "In \(p.days) days")).font(.caption)
                    Spacer()
                    Amount(value: p.net, hide: hide).font(.caption).foregroundStyle(.green)
                }
            }
        }
    }

    @ViewBuilder
    func spendingSection(_ s: Summary, _ hide: Bool) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("This month").font(.caption2).textCase(.uppercase).foregroundStyle(.secondary)
            HStack { Text("Income").font(.caption); Spacer(); Amount(value: s.spend.income, hide: hide).font(.caption) }
            HStack { Text("Spent").font(.caption); Spacer(); Amount(value: s.spend.spent, hide: hide).font(.caption) }
        }
    }

    @ViewBuilder
    func goalSection(_ s: Summary) -> some View {
        if let g = s.goal {
            HStack(spacing: 10) {
                Ring(fraction: Double(g.pct) / 100, tint: Color.accentColor)
                    .frame(width: 34, height: 34)
                VStack(alignment: .leading, spacing: 1) {
                    Text(g.name).font(.caption).lineLimit(1)
                    Text("\(g.pct)% of the way").font(.caption2).foregroundStyle(.secondary)
                }
                Spacer()
            }
        }
    }

    @ViewBuilder
    func debtSection(_ s: Summary, _ hide: Bool) -> some View {
        if let d = s.debt {
            VStack(alignment: .leading, spacing: 2) {
                Text("Debts").font(.caption2).textCase(.uppercase).foregroundStyle(.secondary)
                HStack { Text("You owe").font(.caption); Spacer(); Amount(value: d.total, hide: hide).font(.caption) }
                if d.monthly > 0 {
                    HStack { Text("Monthly payments").font(.caption2).foregroundStyle(.secondary); Spacer(); Amount(value: d.monthly, hide: hide).font(.caption2) }
                }
            }
        }
    }

    @ViewBuilder
    func subsSection(_ s: Summary, _ hide: Bool) -> some View {
        if let v = s.subs {
            HStack {
                Text("\(v.count) subscriptions").font(.caption)
                Spacer()
                HStack(spacing: 0) { Amount(value: v.monthly, hide: hide); Text("/mo") }.font(.caption)
            }
        }
    }

    @ViewBuilder
    func creditSection(_ s: Summary) -> some View {
        if let c = s.credit {
            HStack {
                Text("Credit score").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Text("\(c.score)").font(.caption).bold()
                if let d = c.diff, d != 0 {
                    Text(d > 0 ? "▲ +\(d)" : "▼ \(d)").font(.caption2).foregroundStyle(d > 0 ? Color.green : Color.red)
                }
            }
        }
    }
}

struct TallyWidget: Widget {
    let kind = "TallyWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            TallyWidgetView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Agent X")
        .description("Net worth, investments, budgets, bills and more. Choose what it shows in the app.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

@main
struct TallyWidgetBundle: WidgetBundle {
    var body: some Widget { TallyWidget() }
}
