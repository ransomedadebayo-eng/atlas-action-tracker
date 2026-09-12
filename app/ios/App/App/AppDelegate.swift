import Security
import SQLite3
import SwiftUI
import WebKit
import LocalAuthentication

@main
struct AtlasNativeApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var store = AtlasStore()
    @StateObject private var accessSession = AtlasAccessSession()
    @StateObject private var supabaseSession = NativeSupabaseSession(appName: "Atlas", keychainService: "app.ransomed.atlas.supabase")

    var body: some Scene {
        WindowGroup {
            AtlasRootView()
                .environmentObject(store)
                .environmentObject(accessSession)
                .environmentObject(supabaseSession)
                .preferredColorScheme(.dark)
                .task {
                    store.configure(accessSession: accessSession, supabaseSession: supabaseSession)
                    await store.load()
                }
                .onChange(of: scenePhase) { phase in
                    guard phase == .active else { return }
                    Task { await store.load() }
                }
        }
    }
}

@MainActor
final class AtlasStore: ObservableObject {
    @Published private(set) var state: AtlasLoadState = .idle
    @Published private(set) var actions: [AtlasAction] = []
    @Published private(set) var lastUpdated: Date?
    @Published private(set) var lastAccessDiagnostic = "Not checked yet."
    @Published private(set) var syncStatus = MobileSyncStatus()
    @Published private(set) var mutationMessage: String?

    private let client = AtlasAPIClient()
    private let syncStore = MobileSyncStore(appName: "Atlas")
    private let syncScope = "atlas.actions"
    private var accessSession: AtlasAccessSession?
    private var supabaseSession: NativeSupabaseSession?

    init() {
        syncStatus = syncStore.status(scope: syncScope)
        if let cached = syncStore.loadValue([AtlasAction].self, forKey: syncScope) {
            actions = cached.sorted(by: AtlasAction.sortForFocus)
            lastUpdated = syncStatus.lastSuccessfulSyncAt
            lastAccessDiagnostic = "Showing cached Atlas actions while Supabase refresh starts."
            state = .loaded
        }
    }

    func configure(accessSession: AtlasAccessSession, supabaseSession: NativeSupabaseSession) {
        self.accessSession = accessSession
        self.supabaseSession = supabaseSession
    }

    var activeActions: [AtlasAction] {
        actions.filter(\.isOpenForMobile)
    }

    var focusActions: [AtlasAction] {
        activeActions
            .filter { $0.priorityRank <= 2 || $0.isDueSoon || $0.isBlocked }
            .sorted(by: AtlasAction.sortForFocus)
    }

    var primaryExecutionAction: AtlasAction? {
        focusActions.first { !$0.isDone && !$0.isBlocked && !$0.needsReview }
            ?? dueTodayActions.first { !$0.isDone && !$0.isBlocked }
            ?? inProgressActions.first { !$0.isDone && !$0.isBlocked }
            ?? focusActions.first { !$0.isDone }
            ?? upNextActions.first { !$0.isDone }
    }

    var blockedActions: [AtlasAction] {
        activeActions
            .filter { $0.isBlocked || !$0.blockedBy.isEmpty }
            .sorted(by: AtlasAction.sortForFocus)
    }

    var dueSoonActions: [AtlasAction] {
        activeActions
            .filter(\.isDueSoon)
            .sorted(by: AtlasAction.sortForFocus)
    }

    var writesEnabled: Bool {
        supabaseSession?.isAuthenticated == true && syncStatus.lastError == nil
    }

    var writeReadinessMessage: String {
        if supabaseSession?.isAuthenticated != true {
            return "Sign in to enable Start, Done, Block, and Capture."
        }
        if let lastError = syncStatus.lastError {
            return "Writes are held until refresh recovers: \(lastError)"
        }
        return "Online write path ready. Atlas uses revision checks and appends activity evidence."
    }

    var reviewActions: [AtlasAction] {
        activeActions
            .filter { $0.needsReview }
            .sorted(by: AtlasAction.sortForReview)
    }

    var onFireActions: [AtlasAction] {
        activeActions
            .filter { $0.priorityRank == 0 || $0.isOverdue }
            .sorted { lhs, rhs in
                if lhs.priorityRank != rhs.priorityRank {
                    return lhs.priorityRank < rhs.priorityRank
                }
                return lhs.daysOverdue > rhs.daysOverdue
            }
    }

    var dueTodayActions: [AtlasAction] {
        activeActions
            .filter { $0.isDueToday && !($0.priorityRank == 0 || $0.isOverdue) }
            .sorted(by: AtlasAction.sortForFocus)
    }

    var reviewRequiredActions: [AtlasAction] {
        reviewActions
            .filter { !($0.priorityRank == 0 || $0.isOverdue || $0.isDueToday) }
    }

    var inProgressActions: [AtlasAction] {
        activeActions
            .filter { $0.isActiveWork && !($0.priorityRank == 0 || $0.isOverdue || $0.isDueToday || $0.needsReview) }
            .sorted(by: AtlasAction.sortForFocus)
    }

    var upNextActions: [AtlasAction] {
        activeActions
            .filter { !$0.isActiveWork && !($0.priorityRank == 0 || $0.isOverdue || $0.isDueToday || $0.needsReview) }
            .sorted(by: AtlasAction.sortForFocus)
    }

    func load() async {
        state = .loading
        if let supabaseSession, supabaseSession.refreshTokenAvailable {
            _ = await supabaseSession.refreshSavedSessionIfPossible()
        }
        lastAccessDiagnostic = supabaseSession?.isAuthenticated == true ? "Checking Atlas with native Supabase session." : "Checking API without native Supabase session."
        do {
            let loaded = try await client.fetchActions(accessHeaders: accessSession?.accessHeaders ?? [:], supabaseSession: supabaseSession)
            actions = loaded.sorted(by: AtlasAction.sortForFocus)
            lastUpdated = Date()
            syncStore.saveValue(actions, forKey: syncScope)
            syncStore.markSuccess(scope: syncScope)
            syncStatus = syncStore.status(scope: syncScope)
            lastAccessDiagnostic = supabaseSession?.isAuthenticated == true ? "Supabase returned Atlas actions successfully." : "API returned JSON actions successfully."
            state = .loaded
        } catch AtlasAPIError.protected(let detail) {
            syncStore.markFailure(scope: syncScope, message: detail)
            syncStatus = syncStore.status(scope: syncScope)
            if let cached = syncStore.loadValue([AtlasAction].self, forKey: syncScope) {
                actions = cached.sorted(by: AtlasAction.sortForFocus)
                lastAccessDiagnostic = "Showing cached Atlas actions. Latest refresh was blocked: \(detail)"
                state = .loaded
                return
            }
            actions = []
            lastAccessDiagnostic = detail
            state = .protected
        } catch {
            syncStore.markFailure(scope: syncScope, message: error.localizedDescription)
            syncStatus = syncStore.status(scope: syncScope)
            if let cached = syncStore.loadValue([AtlasAction].self, forKey: syncScope) {
                actions = cached.sorted(by: AtlasAction.sortForFocus)
                lastAccessDiagnostic = "Showing cached Atlas actions. Latest refresh failed: \(error.localizedDescription)"
                state = .loaded
                return
            }
            lastAccessDiagnostic = error.localizedDescription
            state = .failed(error.localizedDescription)
        }
    }

    func transition(_ action: AtlasAction, to status: String) async {
        guard let supabaseSession, supabaseSession.isAuthenticated else {
            mutationMessage = "Sign in before changing Atlas actions."
            return
        }

        _ = await supabaseSession.refreshSavedSessionIfPossible()
        mutationMessage = "Saving \(status.replacingOccurrences(of: "_", with: " "))..."
        do {
            try await client.updateActionStatus(action, status: status, session: supabaseSession)
            mutationMessage = "Action updated."
            await load()
        } catch AtlasAPIError.conflict {
            mutationMessage = "Changed elsewhere. Pull to refresh before saving."
        } catch AtlasAPIError.evidenceMissing(let detail) {
            mutationMessage = "Status saved. Evidence row needs retry: \(detail)"
            await load()
        } catch {
            mutationMessage = error.localizedDescription
        }
    }

    func createAction(_ draft: AtlasActionDraft) async {
        guard let supabaseSession, supabaseSession.isAuthenticated else {
            mutationMessage = "Sign in before adding Atlas actions."
            return
        }
        guard draft.isValid else {
            mutationMessage = draft.validationMessage
            return
        }

        _ = await supabaseSession.refreshSavedSessionIfPossible()
        mutationMessage = "Creating action..."
        do {
            try await client.createAction(draft: draft, session: supabaseSession)
            mutationMessage = "Action created."
            await load()
        } catch {
            mutationMessage = "Action not created: \(error.localizedDescription)"
        }
    }

    func updateAction(_ action: AtlasAction, draft: AtlasActionDraft) async {
        guard let supabaseSession, supabaseSession.isAuthenticated else {
            mutationMessage = "Sign in before editing Atlas actions."
            return
        }
        guard draft.isValid else {
            mutationMessage = draft.validationMessage
            return
        }

        _ = await supabaseSession.refreshSavedSessionIfPossible()
        mutationMessage = "Saving action..."
        do {
            try await client.updateAction(action, draft: draft, session: supabaseSession)
            mutationMessage = "Action saved."
            await load()
        } catch AtlasAPIError.conflict {
            mutationMessage = "Changed elsewhere. Pull to refresh before saving."
        } catch {
            mutationMessage = "Action not saved: \(error.localizedDescription)"
        }
    }

    func captureEvidence(_ action: AtlasAction, note: String) async {
        guard let supabaseSession, supabaseSession.isAuthenticated else {
            mutationMessage = "Sign in before capturing Atlas evidence."
            return
        }

        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            mutationMessage = "Add a short evidence note before saving capture."
            return
        }

        _ = await supabaseSession.refreshSavedSessionIfPossible()
        mutationMessage = "Saving capture..."
        do {
            try await client.insertActivityLog(
                action: action,
                event: "evidence_captured",
                oldValue: action.status ?? "not_started",
                newValue: trimmed,
                session: supabaseSession
            )
            mutationMessage = "Capture saved to activity."
            await load()
        } catch {
            mutationMessage = "Capture not saved: \(error.localizedDescription)"
        }
    }
}

struct MobileSyncStatus: Equatable {
    var lastSuccessfulSyncAt: Date?
    var lastError: String?
    var pendingWrites: Int = 0

    var summary: String {
        if let lastSuccessfulSyncAt {
            return "Last synced \(lastSuccessfulSyncAt.formatted(date: .abbreviated, time: .shortened))"
        }
        return "No completed sync yet"
    }
}

final class MobileSyncStore {
    private let appName: String
    private var db: OpaquePointer?

    init(appName: String) {
        self.appName = appName
        open()
        migrate()
    }

    deinit {
        sqlite3_close(db)
    }

    func loadValue<T: Decodable>(_ type: T.Type, forKey key: String) -> T? {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, "select json from cache_entries where key = ? limit 1", -1, &statement, nil) == SQLITE_OK else { return nil }
        defer { sqlite3_finalize(statement) }
        sqlite3_bind_text(statement, 1, key, -1, transientDestructor)
        guard sqlite3_step(statement) == SQLITE_ROW, let cString = sqlite3_column_text(statement, 0) else { return nil }
        return try? JSONDecoder.mobileSync.decode(type, from: Data(String(cString: cString).utf8))
    }

    func saveValue<T: Encodable>(_ value: T, forKey key: String) {
        guard let data = try? JSONEncoder.mobileSync.encode(value), let json = String(data: data, encoding: .utf8) else { return }
        execute(
            "insert into cache_entries(key, json, updated_at) values (?, ?, ?) on conflict(key) do update set json = excluded.json, updated_at = excluded.updated_at",
            values: [key, json, Self.isoNow()]
        )
    }

    func markSuccess(scope: String) {
        execute(
            "insert into sync_meta(scope, last_success_at, last_error) values (?, ?, null) on conflict(scope) do update set last_success_at = excluded.last_success_at, last_error = null",
            values: [scope, Self.isoNow()]
        )
    }

    func markFailure(scope: String, message: String) {
        execute(
            "insert into sync_meta(scope, last_error) values (?, ?) on conflict(scope) do update set last_error = excluded.last_error",
            values: [scope, message]
        )
    }

    func status(scope: String) -> MobileSyncStatus {
        var statement: OpaquePointer?
        var status = MobileSyncStatus(pendingWrites: pendingWriteCount())
        guard sqlite3_prepare_v2(db, "select last_success_at, last_error from sync_meta where scope = ? limit 1", -1, &statement, nil) == SQLITE_OK else { return status }
        defer { sqlite3_finalize(statement) }
        sqlite3_bind_text(statement, 1, scope, -1, transientDestructor)
        guard sqlite3_step(statement) == SQLITE_ROW else { return status }
        if let cString = sqlite3_column_text(statement, 0) {
            status.lastSuccessfulSyncAt = ISO8601DateFormatter().date(from: String(cString: cString))
        }
        if let cString = sqlite3_column_text(statement, 1) {
            status.lastError = String(cString: cString)
        }
        return status
    }

    private func open() {
        let fileManager = FileManager.default
        let directory = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent(appName, isDirectory: true)
        try? fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent("mobile-sync.sqlite")
        sqlite3_open(url.path, &db)
        try? fileManager.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: url.path)
    }

    private func migrate() {
        sqlite3_exec(db, "create table if not exists cache_entries(key text primary key, json text not null, updated_at text not null)", nil, nil, nil)
        sqlite3_exec(db, "create table if not exists sync_meta(scope text primary key, last_success_at text, last_error text)", nil, nil, nil)
        sqlite3_exec(db, "create table if not exists pending_mutations(id text primary key, scope text not null, operation text not null, payload text not null, created_at text not null)", nil, nil, nil)
    }

    private func pendingWriteCount() -> Int {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, "select count(*) from pending_mutations", -1, &statement, nil) == SQLITE_OK else { return 0 }
        defer { sqlite3_finalize(statement) }
        guard sqlite3_step(statement) == SQLITE_ROW else { return 0 }
        return Int(sqlite3_column_int(statement, 0))
    }

    private func execute(_ sql: String, values: [String]) {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else { return }
        defer { sqlite3_finalize(statement) }
        for (index, value) in values.enumerated() {
            sqlite3_bind_text(statement, Int32(index + 1), value, -1, transientDestructor)
        }
        sqlite3_step(statement)
    }

    private var transientDestructor: sqlite3_destructor_type {
        unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    }

    private static func isoNow() -> String {
        ISO8601DateFormatter().string(from: Date())
    }
}

private extension JSONEncoder {
    static var mobileSync: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}

private extension JSONDecoder {
    static var mobileSync: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}

enum AtlasLoadState: Equatable {
    case idle
    case loading
    case loaded
    case protected
    case failed(String)
}

@MainActor
struct AtlasAPIClient {
    private let baseURL = URL(string: "https://atlas.ransomed.app")!
    private let supabaseRestURL = URL(string: "https://vdezxdeushxaacyfjeeh.supabase.co/rest/v1")!

    func fetchActions(accessHeaders: [String: String], supabaseSession: NativeSupabaseSession?) async throws -> [AtlasAction] {
        if let supabaseSession, supabaseSession.isAuthenticated {
            return try await fetchActionsFromSupabase(session: supabaseSession)
        }

        var components = URLComponents(url: baseURL.appendingPathComponent("/api/actions"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "status", value: "not_started,in_progress,waiting,blocked,todo,open"),
            URLQueryItem(name: "sort_by", value: "due_date"),
            URLQueryItem(name: "sort_dir", value: "asc"),
            URLQueryItem(name: "show_blocked", value: "true")
        ]

        var request = URLRequest(url: components.url!)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        for header in accessHeaders {
            request.setValue(header.value, forHTTPHeaderField: header.key)
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw AtlasAPIError.invalidResponse
        }

        let contentType = http.value(forHTTPHeaderField: "content-type")?.lowercased() ?? ""
        let finalHost = http.url?.host?.lowercased() ?? ""

        if http.statusCode == 401 || http.statusCode == 403 || finalHost.contains("cloudflareaccess.com") || !contentType.contains("application/json") {
            let diagnostic = "HTTP \(http.statusCode), host \(finalHost.isEmpty ? "unknown" : finalHost), content \(contentType.isEmpty ? "unknown" : contentType)."
            throw AtlasAPIError.protected(diagnostic)
        }

        guard (200..<300).contains(http.statusCode) else {
            throw AtlasAPIError.server(http.statusCode)
        }

        return try JSONDecoder().decode([AtlasAction].self, from: data)
    }

    private func fetchActionsFromSupabase(session: NativeSupabaseSession) async throws -> [AtlasAction] {
        var components = URLComponents(url: supabaseRestURL.appendingPathComponent("atlas_actions"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "select", value: "*"),
            URLQueryItem(name: "status", value: "in.(not_started,in_progress,waiting,blocked,todo,open)"),
            URLQueryItem(name: "order", value: "due_date.asc.nullslast"),
            URLQueryItem(name: "limit", value: "200")
        ]

        var request = URLRequest(url: components.url!)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        for header in session.authHeaders {
            request.setValue(header.value, forHTTPHeaderField: header.key)
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw AtlasAPIError.invalidResponse
        }

        guard (200..<300).contains(http.statusCode) else {
            let body = String(decoding: data.prefix(512), as: UTF8.self)
            throw AtlasAPIError.protected("Supabase HTTP \(http.statusCode): \(body)")
        }

        return try JSONDecoder().decode([AtlasAction].self, from: data)
    }

    func updateActionStatus(_ action: AtlasAction, status: String, session: NativeSupabaseSession) async throws {
        guard var components = URLComponents(url: supabaseRestURL.appendingPathComponent("atlas_actions"), resolvingAgainstBaseURL: false) else {
            throw AtlasAPIError.invalidResponse
        }
        components.queryItems = [
            URLQueryItem(name: "id", value: "eq.\(action.id)"),
            URLQueryItem(name: "revision", value: "eq.\(action.revision)")
        ]
        guard let url = components.url else { throw AtlasAPIError.invalidResponse }

        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("return=representation", forHTTPHeaderField: "Prefer")
        for header in session.authHeaders {
            request.setValue(header.value, forHTTPHeaderField: header.key)
        }

        let patch = AtlasActionStatusPatch(
            status: status,
            revision: action.revision + 1,
            updatedBy: session.currentUserID,
            updatedSource: "ios",
            completedAt: (status == "done" || status == "completed") ? ISO8601DateFormatter().string(from: Date()) : nil,
            evidenceJson: (status == "done" || status == "completed") ? AtlasCompletionEvidence.manual(action: action) : nil
        )
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        request.httpBody = try encoder.encode(patch)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw AtlasAPIError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            let body = String(decoding: data.prefix(512), as: UTF8.self)
            throw AtlasAPIError.protected("Supabase HTTP \(http.statusCode): \(body)")
        }
        if http.statusCode == 204 || data.isEmpty {
            throw AtlasAPIError.conflict
        }
        let updated = try JSONDecoder().decode([AtlasAction].self, from: data)
        if updated.isEmpty {
            throw AtlasAPIError.conflict
        }
        do {
            try await insertActivityLog(
                action: action,
                event: "status_changed",
                oldValue: action.status ?? "not_started",
                newValue: status,
                session: session
            )
        } catch {
            throw AtlasAPIError.evidenceMissing(error.localizedDescription)
        }
    }

    func createAction(draft: AtlasActionDraft, session: NativeSupabaseSession) async throws {
        guard let url = URLComponents(url: supabaseRestURL.appendingPathComponent("atlas_actions"), resolvingAgainstBaseURL: false)?.url else {
            throw AtlasAPIError.invalidResponse
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("return=representation", forHTTPHeaderField: "Prefer")
        for header in session.authHeaders {
            request.setValue(header.value, forHTTPHeaderField: header.key)
        }

        let now = ISO8601DateFormatter().string(from: Date())
        let row = AtlasActionCreateInsert(
            id: UUID().uuidString,
            title: draft.normalizedTitle,
            description: draft.normalizedDescription,
            notes: draft.normalizedNotes,
            status: draft.status,
            priority: draft.priority,
            business: draft.normalizedBusiness,
            dueDate: draft.normalizedDueDate,
            reviewDate: draft.normalizedReviewDate,
            nextAction: draft.normalizedNextAction,
            definitionOfDone: draft.normalizedDefinitionOfDone,
            workMode: draft.normalizedWorkMode,
            approvalState: draft.normalizedApprovalState,
            owners: draft.normalizedOwners,
            tags: draft.normalizedTags,
            sourceLabel: "ios",
            recurrence: "none",
            revision: 1,
            updatedBy: session.currentUserID,
            updatedSource: "ios",
            createdAt: now,
            updatedAt: now
        )
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        request.httpBody = try encoder.encode(row)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw AtlasAPIError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            let body = String(decoding: data.prefix(512), as: UTF8.self)
            throw AtlasAPIError.protected("Supabase HTTP \(http.statusCode): \(body)")
        }
    }

    func updateAction(_ action: AtlasAction, draft: AtlasActionDraft, session: NativeSupabaseSession) async throws {
        guard var components = URLComponents(url: supabaseRestURL.appendingPathComponent("atlas_actions"), resolvingAgainstBaseURL: false) else {
            throw AtlasAPIError.invalidResponse
        }
        components.queryItems = [
            URLQueryItem(name: "id", value: "eq.\(action.id)"),
            URLQueryItem(name: "revision", value: "eq.\(action.revision)")
        ]
        guard let url = components.url else { throw AtlasAPIError.invalidResponse }

        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("return=representation", forHTTPHeaderField: "Prefer")
        for header in session.authHeaders {
            request.setValue(header.value, forHTTPHeaderField: header.key)
        }

        let patch = AtlasActionEditPatch(
            title: draft.normalizedTitle,
            description: draft.normalizedDescription,
            notes: draft.normalizedNotes,
            status: draft.status,
            priority: draft.priority,
            business: draft.normalizedBusiness,
            dueDate: draft.normalizedDueDate,
            reviewDate: draft.normalizedReviewDate,
            nextAction: draft.normalizedNextAction,
            definitionOfDone: draft.normalizedDefinitionOfDone,
            workMode: draft.normalizedWorkMode,
            approvalState: draft.normalizedApprovalState,
            owners: draft.normalizedOwners,
            tags: draft.normalizedTags,
            revision: action.revision + 1,
            updatedBy: session.currentUserID,
            updatedSource: "ios",
            updatedAt: ISO8601DateFormatter().string(from: Date())
        )
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        request.httpBody = try encoder.encode(patch)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw AtlasAPIError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            let body = String(decoding: data.prefix(512), as: UTF8.self)
            throw AtlasAPIError.protected("Supabase HTTP \(http.statusCode): \(body)")
        }
        if http.statusCode == 204 || data.isEmpty {
            throw AtlasAPIError.conflict
        }
        let updated = try JSONDecoder().decode([AtlasAction].self, from: data)
        if updated.isEmpty {
            throw AtlasAPIError.conflict
        }
        try? await insertActivityLog(
            action: action,
            event: "edited",
            oldValue: "r\(action.revision)",
            newValue: "r\(action.revision + 1)",
            session: session
        )
    }

    func insertActivityLog(action: AtlasAction, event: String, oldValue: String, newValue: String, session: NativeSupabaseSession) async throws {
        guard var components = URLComponents(url: supabaseRestURL.appendingPathComponent("atlas_activity_log"), resolvingAgainstBaseURL: false) else {
            throw AtlasAPIError.invalidResponse
        }
        components.queryItems = []
        guard let url = components.url else { throw AtlasAPIError.invalidResponse }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("return=minimal", forHTTPHeaderField: "Prefer")
        for header in session.authHeaders {
            request.setValue(header.value, forHTTPHeaderField: header.key)
        }

        let row = AtlasActivityLogInsert(
            actionId: action.id,
            event: event,
            oldValue: oldValue,
            newValue: newValue,
            actor: "ios:\(session.email ?? session.currentUserID ?? "unknown")"
        )
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        request.httpBody = try encoder.encode(row)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw AtlasAPIError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            let body = String(decoding: data.prefix(512), as: UTF8.self)
            throw AtlasAPIError.protected("Atlas activity log HTTP \(http.statusCode): \(body)")
        }
    }
}

private struct AtlasActionStatusPatch: Encodable {
    let status: String
    let revision: Int
    let updatedBy: String?
    let updatedSource: String
    let completedAt: String?
    let evidenceJson: AtlasCompletionEvidence?
}

private struct AtlasActionCreateInsert: Encodable {
    let id: String
    let title: String
    let description: String?
    let notes: String?
    let status: String
    let priority: String
    let business: String
    let dueDate: String?
    let reviewDate: String?
    let nextAction: String?
    let definitionOfDone: String?
    let workMode: String?
    let approvalState: String?
    let owners: [String]
    let tags: [String]
    let sourceLabel: String
    let recurrence: String
    let revision: Int
    let updatedBy: String?
    let updatedSource: String
    let createdAt: String
    let updatedAt: String
}

private struct AtlasActionEditPatch: Encodable {
    let title: String
    let description: String?
    let notes: String?
    let status: String
    let priority: String
    let business: String
    let dueDate: String?
    let reviewDate: String?
    let nextAction: String?
    let definitionOfDone: String?
    let workMode: String?
    let approvalState: String?
    let owners: [String]
    let tags: [String]
    let revision: Int
    let updatedBy: String?
    let updatedSource: String
    let updatedAt: String
}

private struct AtlasCompletionEvidence: Encodable {
    let manualCompletion: ManualCompletion

    struct ManualCompletion: Encodable {
        let completedAt: String
        let source: String
        let note: String
    }

    static func manual(action: AtlasAction) -> AtlasCompletionEvidence {
        AtlasCompletionEvidence(
            manualCompletion: ManualCompletion(
                completedAt: ISO8601DateFormatter().string(from: Date()),
                source: "ios",
                note: action.completionProof.nilIfBlank ?? "Marked manually done in Atlas iOS."
            )
        )
    }
}

private struct AtlasActivityLogInsert: Encodable {
    let actionId: String
    let event: String
    let oldValue: String
    let newValue: String
    let actor: String
}

enum AtlasAPIError: LocalizedError {
    case protected(String)
    case invalidResponse
    case server(Int)
    case conflict
    case evidenceMissing(String)

    var errorDescription: String? {
        switch self {
        case .protected:
            return "Atlas is protected by Cloudflare Access."
        case .invalidResponse:
            return "Atlas returned an invalid response."
        case .server(let code):
            return "Atlas returned HTTP \(code)."
        case .conflict:
            return "Atlas action changed elsewhere."
        case .evidenceMissing(let message):
            return "Atlas saved the status, but activity evidence needs retry: \(message)"
        }
    }
}

@MainActor
final class AtlasAccessSession: ObservableObject {
    @Published private(set) var authorizationCookieHeader: String?
    @Published private(set) var serviceTokenId: String?
    @Published private(set) var serviceTokenSecret: String?

    private let service = "app.ransomed.atlas.cloudflare-access"
    private let cookieAccount = "CF_Authorization"
    private let serviceTokenIdAccount = "CF_Access_Client_Id"
    private let serviceTokenSecretAccount = "CF_Access_Client_Secret"

    init() {
        authorizationCookieHeader = KeychainStore.read(service: service, account: cookieAccount)
        serviceTokenId = KeychainStore.read(service: service, account: serviceTokenIdAccount)
        serviceTokenSecret = KeychainStore.read(service: service, account: serviceTokenSecretAccount)
    }

    var isSignedIn: Bool {
        authorizationCookieHeader?.isEmpty == false
    }

    var hasServiceToken: Bool {
        serviceTokenId?.isEmpty == false && serviceTokenSecret?.isEmpty == false
    }

    var hasAccessCredential: Bool {
        isSignedIn || hasServiceToken
    }

    var accessHeaders: [String: String] {
        if let authorizationCookieHeader, !authorizationCookieHeader.isEmpty {
            return ["Cookie": authorizationCookieHeader]
        }
        guard let serviceTokenId,
              let serviceTokenSecret,
              !serviceTokenId.isEmpty,
              !serviceTokenSecret.isEmpty
        else {
            return [:]
        }
        return [
            "CF-Access-Client-Id": serviceTokenId,
            "CF-Access-Client-Secret": serviceTokenSecret
        ]
    }

    func save(cookieHeader: String) {
        authorizationCookieHeader = cookieHeader
        KeychainStore.save(cookieHeader, service: service, account: cookieAccount)
    }

    func saveCookieInput(_ input: String) {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        if trimmed.localizedCaseInsensitiveContains("CF_Authorization=") {
            save(cookieHeader: trimmed)
        } else {
            save(cookieHeader: "CF_Authorization=\(trimmed)")
        }
    }

    func saveServiceToken(id: String, secret: String) {
        let trimmedId = id.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedSecret = secret.trimmingCharacters(in: .whitespacesAndNewlines)
        serviceTokenId = trimmedId
        serviceTokenSecret = trimmedSecret
        KeychainStore.save(trimmedId, service: service, account: serviceTokenIdAccount)
        KeychainStore.save(trimmedSecret, service: service, account: serviceTokenSecretAccount)
    }

    func signOut() {
        authorizationCookieHeader = nil
        serviceTokenId = nil
        serviceTokenSecret = nil
        KeychainStore.delete(service: service, account: cookieAccount)
        KeychainStore.delete(service: service, account: serviceTokenIdAccount)
        KeychainStore.delete(service: service, account: serviceTokenSecretAccount)
        HTTPCookieStorage.shared.cookies?
            .filter { $0.name == "CF_Authorization" && $0.domain.contains("ransomed.app") }
            .forEach(HTTPCookieStorage.shared.deleteCookie)
        WKWebsiteDataStore.default().httpCookieStore.getAllCookies { cookies in
            cookies
                .filter { $0.name == "CF_Authorization" && $0.domain.contains("ransomed.app") }
                .forEach { WKWebsiteDataStore.default().httpCookieStore.delete($0) }
        }
    }
}

enum KeychainStore {
    static func read(service: String, account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess,
              let data = item as? Data,
              let value = String(data: data, encoding: .utf8)
        else {
            return nil
        }
        return value
    }

    static func save(_ value: String, service: String, account: String) {
        let data = Data(value.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        let attributes: [String: Any] = [kSecValueData as String: data]

        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var addQuery = query
            addQuery[kSecValueData as String] = data
            addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            SecItemAdd(addQuery as CFDictionary, nil)
        }
    }

    static func delete(service: String, account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        SecItemDelete(query as CFDictionary)
    }
}

@MainActor
final class NativeSupabaseSession: ObservableObject {
    @Published private(set) var email: String?
    @Published private(set) var accessToken: String?
    @Published private(set) var refreshTokenAvailable = false
    @Published private(set) var isLoading = false
    @Published var statusMessage = "Sign in with your app email and password."

    private let appName: String
    private let keychainService: String
    private let emailAccount = "supabase_email"
    private let userIDAccount = "supabase_user_id"
    private let accessTokenAccount = "supabase_access_token"
    private let refreshTokenAccount = "supabase_refresh_token"
    private let supabaseURL = URL(string: "https://vdezxdeushxaacyfjeeh.supabase.co")!
    private let anonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZkZXp4ZGV1c2h4YWFjeWZqZWVoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2NzYwMDIsImV4cCI6MjA5MTI1MjAwMn0.Gr3Qs7QMzQa60YJ2nww9Ddyuar94BkVKMbSxa8DPWM0"

    init(appName: String, keychainService: String) {
        self.appName = appName
        self.keychainService = keychainService
        self.email = KeychainStore.read(service: keychainService, account: emailAccount)
        self.accessToken = KeychainStore.read(service: keychainService, account: accessTokenAccount)
        self.refreshTokenAvailable = KeychainStore.read(service: keychainService, account: refreshTokenAccount) != nil
        if isAuthenticated {
            statusMessage = "\(appName) is signed in."
        } else if refreshTokenAvailable {
            statusMessage = "Use Face ID to unlock \(appName)."
        }
    }

    var isAuthenticated: Bool {
        accessToken?.isEmpty == false
    }

    var currentUserID: String? {
        if let saved = KeychainStore.read(service: keychainService, account: userIDAccount), !saved.isEmpty {
            return saved
        }
        guard let accessToken else { return nil }
        return Self.decodeSubject(from: accessToken)
    }

    var authHeaders: [String: String] {
        guard let accessToken, !accessToken.isEmpty else {
            return ["apikey": anonKey]
        }
        return [
            "apikey": anonKey,
            "Authorization": "Bearer \(accessToken)"
        ]
    }

    func signIn(email rawEmail: String, password: String) async {
        let normalizedEmail = rawEmail.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedEmail.isEmpty, !password.isEmpty else {
            statusMessage = "Enter email and password."
            return
        }

        isLoading = true
        defer { isLoading = false }

        do {
            let payload = try await requestToken(grantType: "password", body: [
                "email": normalizedEmail,
                "password": password
            ])
            saveSession(payload: payload, email: normalizedEmail)
            statusMessage = "\(appName) signed in. Face ID unlock is now available."
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func unlockWithFaceID() async {
        guard refreshTokenAvailable,
              let refreshToken = KeychainStore.read(service: keychainService, account: refreshTokenAccount)
        else {
            statusMessage = "No saved session to unlock."
            return
        }

        let context = LAContext()
        context.localizedCancelTitle = "Use password"
        var authError: NSError?
        let policy: LAPolicy = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &authError) ? .deviceOwnerAuthenticationWithBiometrics : .deviceOwnerAuthentication

        do {
            let ok = try await context.evaluatePolicy(policy, localizedReason: "Unlock \(appName)")
            guard ok else {
                statusMessage = "Unlock was cancelled."
                return
            }
            isLoading = true
            defer { isLoading = false }
            let payload = try await requestToken(grantType: "refresh_token", body: ["refresh_token": refreshToken])
            saveSession(payload: payload, email: email)
            statusMessage = "\(appName) unlocked with Face ID."
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func refreshSavedSessionIfPossible() async -> Bool {
        guard refreshTokenAvailable,
              let refreshToken = KeychainStore.read(service: keychainService, account: refreshTokenAccount),
              !refreshToken.isEmpty
        else {
            return false
        }

        do {
            let payload = try await requestToken(grantType: "refresh_token", body: ["refresh_token": refreshToken])
            saveSession(payload: payload, email: email)
            statusMessage = "\(appName) session refreshed."
            return true
        } catch {
            statusMessage = "Saved session refresh failed. Sign in again."
            return false
        }
    }

    func signOut() {
        email = nil
        accessToken = nil
        refreshTokenAvailable = false
        KeychainStore.delete(service: keychainService, account: emailAccount)
        KeychainStore.delete(service: keychainService, account: userIDAccount)
        KeychainStore.delete(service: keychainService, account: accessTokenAccount)
        KeychainStore.delete(service: keychainService, account: refreshTokenAccount)
        statusMessage = "\(appName) signed out."
    }

    private func requestToken(grantType: String, body: [String: String]) async throws -> SupabaseTokenResponse {
        var request = URLRequest(url: supabaseURL.appendingPathComponent("/auth/v1/token").appending(queryItems: [URLQueryItem(name: "grant_type", value: grantType)]))
        request.httpMethod = "POST"
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw SupabaseAuthError.message("Supabase returned an invalid response.")
        }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONDecoder().decode(SupabaseErrorResponse.self, from: data).message) ?? "Supabase sign-in failed with HTTP \(http.statusCode)."
            throw SupabaseAuthError.message(message)
        }
        return try JSONDecoder().decode(SupabaseTokenResponse.self, from: data)
    }

    private func saveSession(payload: SupabaseTokenResponse, email fallbackEmail: String?) {
        email = payload.user.email ?? fallbackEmail
        accessToken = payload.accessToken
        refreshTokenAvailable = !payload.refreshToken.isEmpty
        if let email {
            KeychainStore.save(email, service: keychainService, account: emailAccount)
        }
        KeychainStore.save(payload.user.id, service: keychainService, account: userIDAccount)
        KeychainStore.save(payload.accessToken, service: keychainService, account: accessTokenAccount)
        KeychainStore.save(payload.refreshToken, service: keychainService, account: refreshTokenAccount)
    }

    private static func decodeSubject(from jwt: String) -> String? {
        let parts = jwt.split(separator: ".")
        guard parts.count >= 2 else { return nil }
        var payload = String(parts[1])
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        while payload.count % 4 != 0 {
            payload.append("=")
        }
        guard let data = Data(base64Encoded: payload),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let subject = json["sub"] as? String
        else {
            return nil
        }
        return subject
    }
}

struct SupabaseTokenResponse: Decodable {
    let accessToken: String
    let refreshToken: String
    let user: SupabaseUser

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case user
    }
}

struct SupabaseUser: Decodable {
    let id: String
    let email: String?
}

struct SupabaseErrorResponse: Decodable {
    let message: String?
    let errorDescription: String?

    enum CodingKeys: String, CodingKey {
        case message
        case errorDescription = "error_description"
    }
}

enum SupabaseAuthError: LocalizedError {
    case message(String)

    var errorDescription: String? {
        switch self {
        case .message(let message):
            return message
        }
    }
}

extension URL {
    func appending(queryItems: [URLQueryItem]) -> URL {
        guard var components = URLComponents(url: self, resolvingAgainstBaseURL: false) else {
            return self
        }
        components.queryItems = queryItems
        return components.url ?? self
    }
}

struct AtlasAction: Identifiable, Codable, Hashable {
    let id: String
    let title: String
    let description: String?
    let notes: String?
    let status: String?
    let priority: String?
    let business: String?
    let workMode: String?
    let approvalState: String?
    let sourceLabel: String?
    let dueDate: String?
    let reviewDate: String?
    let nextAction: String?
    let definitionOfDone: String?
    let revision: Int
    let updatedAt: String?
    let updatedSource: String?
    let owners: [String]
    let tags: [String]
    let blockedBy: [String]
    let isBlocked: Bool

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case description
        case notes
        case status
        case priority
        case business
        case workMode = "work_mode"
        case approvalState = "approval_state"
        case sourceLabel = "source_label"
        case dueDate = "due_date"
        case reviewDate = "review_date"
        case nextAction = "next_action"
        case definitionOfDone = "definition_of_done"
        case revision
        case updatedAt = "updated_at"
        case updatedSource = "updated_source"
        case owners
        case tags
        case blockedBy = "blocked_by"
        case isBlocked = "is_blocked"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        title = (try? container.decode(String.self, forKey: .title)) ?? "Untitled action"
        description = try? container.decodeIfPresent(String.self, forKey: .description)
        notes = try? container.decodeIfPresent(String.self, forKey: .notes)
        status = try? container.decodeIfPresent(String.self, forKey: .status)
        priority = try? container.decodeIfPresent(String.self, forKey: .priority)
        business = try? container.decodeIfPresent(String.self, forKey: .business)
        workMode = try? container.decodeIfPresent(String.self, forKey: .workMode)
        approvalState = try? container.decodeIfPresent(String.self, forKey: .approvalState)
        sourceLabel = try? container.decodeIfPresent(String.self, forKey: .sourceLabel)
        dueDate = try? container.decodeIfPresent(String.self, forKey: .dueDate)
        reviewDate = try? container.decodeIfPresent(String.self, forKey: .reviewDate)
        nextAction = try? container.decodeIfPresent(String.self, forKey: .nextAction)
        definitionOfDone = try? container.decodeIfPresent(String.self, forKey: .definitionOfDone)
        revision = (try? container.decodeIfPresent(Int.self, forKey: .revision)) ?? 1
        updatedAt = try? container.decodeIfPresent(String.self, forKey: .updatedAt)
        updatedSource = try? container.decodeIfPresent(String.self, forKey: .updatedSource)
        owners = Self.decodeStringArray(container, key: .owners)
        tags = Self.decodeStringArray(container, key: .tags)
        blockedBy = Self.decodeStringArray(container, key: .blockedBy)
        isBlocked = (try? container.decodeIfPresent(Bool.self, forKey: .isBlocked)) ?? false
    }

    private static func decodeStringArray(_ container: KeyedDecodingContainer<CodingKeys>, key: CodingKeys) -> [String] {
        if let values = try? container.decodeIfPresent([String].self, forKey: key) {
            return values
        }
        if let value = try? container.decodeIfPresent(String.self, forKey: key), !value.isEmpty {
            return [value]
        }
        return []
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(title, forKey: .title)
        try container.encodeIfPresent(description, forKey: .description)
        try container.encodeIfPresent(notes, forKey: .notes)
        try container.encodeIfPresent(status, forKey: .status)
        try container.encodeIfPresent(priority, forKey: .priority)
        try container.encodeIfPresent(business, forKey: .business)
        try container.encodeIfPresent(workMode, forKey: .workMode)
        try container.encodeIfPresent(approvalState, forKey: .approvalState)
        try container.encodeIfPresent(sourceLabel, forKey: .sourceLabel)
        try container.encodeIfPresent(dueDate, forKey: .dueDate)
        try container.encodeIfPresent(reviewDate, forKey: .reviewDate)
        try container.encodeIfPresent(nextAction, forKey: .nextAction)
        try container.encodeIfPresent(definitionOfDone, forKey: .definitionOfDone)
        try container.encode(revision, forKey: .revision)
        try container.encodeIfPresent(updatedAt, forKey: .updatedAt)
        try container.encodeIfPresent(updatedSource, forKey: .updatedSource)
        try container.encode(owners, forKey: .owners)
        try container.encode(tags, forKey: .tags)
        try container.encode(blockedBy, forKey: .blockedBy)
        try container.encode(isBlocked, forKey: .isBlocked)
    }

    var statusLabel: String {
        display(canonicalStatus, fallback: "Not started")
    }

    var priorityLabel: String {
        display(priority, fallback: "Priority")
    }

    var workModeLabel: String {
        display(workMode, fallback: "Unassigned")
    }

    var primaryDetail: String {
        nextAction?.nilIfBlank ?? description?.nilIfBlank ?? notes?.nilIfBlank ?? "No next action captured."
    }

    var completionProof: String {
        definitionOfDone?.nilIfBlank ?? "No definition of done captured."
    }

    var isDone: Bool {
        canonicalStatus == "done"
    }

    var isOpenForMobile: Bool {
        !isDone
    }

    var needsReview: Bool {
        let mode = workMode?.lowercased() ?? ""
        let approval = approvalState?.lowercased() ?? ""
        return mode.contains("review") || mode.contains("user") || approval.contains("pending") || reviewDate != nil
    }

    var isDueSoon: Bool {
        guard let dueDate, let due = Self.dateFormatter.date(from: dueDate) else {
            return false
        }
        let days = Calendar.current.dateComponents([.day], from: Date(), to: due).day ?? 99
        return days <= 7
    }

    var isDueToday: Bool {
        guard let dueDate, let due = Self.dateFormatter.date(from: dueDate) else {
            return false
        }
        return Calendar.current.isDateInToday(due)
    }

    var isOverdue: Bool {
        guard !isDone, let dueDate, let due = Self.dateFormatter.date(from: dueDate) else {
            return false
        }
        return due < Calendar.current.startOfDay(for: Date())
    }

    var daysOverdue: Int {
        guard isOverdue, let dueDate, let due = Self.dateFormatter.date(from: dueDate) else {
            return 0
        }
        return Calendar.current.dateComponents([.day], from: due, to: Calendar.current.startOfDay(for: Date())).day ?? 0
    }

    var isActiveWork: Bool {
        let normalized = canonicalStatus
        return normalized.contains("progress") || normalized.contains("waiting") || normalized.contains("blocked") || isBlocked
    }

    var canonicalStatus: String {
        let normalized = (status ?? "not_started")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        switch normalized {
        case "completed", "complete", "cancelled", "canceled", "frozen", "archived":
            return "done"
        case "todo", "open":
            return "not_started"
        default:
            return normalized.isEmpty ? "not_started" : normalized
        }
    }

    var priorityRank: Int {
        switch priority?.lowercased() {
        case "p0", "urgent": return 0
        case "p1", "high": return 1
        case "p2", "medium": return 2
        case "p3", "low": return 3
        default: return 4
        }
    }

    static func sortForFocus(_ lhs: AtlasAction, _ rhs: AtlasAction) -> Bool {
        if lhs.priorityRank != rhs.priorityRank {
            return lhs.priorityRank < rhs.priorityRank
        }
        return (lhs.dueDate ?? "9999-12-31") < (rhs.dueDate ?? "9999-12-31")
    }

    static func sortForReview(_ lhs: AtlasAction, _ rhs: AtlasAction) -> Bool {
        (lhs.reviewDate ?? lhs.dueDate ?? "9999-12-31") < (rhs.reviewDate ?? rhs.dueDate ?? "9999-12-31")
    }

    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    private func display(_ value: String?, fallback: String) -> String {
        guard let value = value?.nilIfBlank else {
            return fallback
        }
        return value
            .replacingOccurrences(of: "_", with: " ")
            .split(separator: " ")
            .map { $0.prefix(1).uppercased() + $0.dropFirst() }
            .joined(separator: " ")
    }
}

struct AtlasActionDraft: Equatable {
    var title: String = ""
    var business: String = ""
    var priority: String = "p2"
    var status: String = "not_started"
    var nextAction: String = ""
    var definitionOfDone: String = ""
    var description: String = ""
    var notes: String = ""
    var dueDate: String = ""
    var reviewDate: String = ""
    var ownersText: String = ""
    var tagsText: String = ""
    var workMode: String = ""
    var approvalState: String = "not_required"

    static func from(action: AtlasAction) -> AtlasActionDraft {
        AtlasActionDraft(
            title: action.title,
            business: action.business ?? "",
            priority: action.priority ?? "p2",
            status: action.canonicalStatus,
            nextAction: action.nextAction ?? "",
            definitionOfDone: action.definitionOfDone ?? "",
            description: action.description ?? "",
            notes: action.notes ?? "",
            dueDate: action.dueDate ?? "",
            reviewDate: action.reviewDate ?? "",
            ownersText: action.owners.joined(separator: ", "),
            tagsText: action.tags.joined(separator: ", "),
            workMode: action.workMode ?? "",
            approvalState: action.approvalState ?? "not_required"
        )
    }

    var isValid: Bool {
        validationMessage == nil
    }

    var validationMessage: String? {
        if normalizedTitle.isEmpty {
            return "Add a title before saving."
        }
        if normalizedBusiness.isEmpty {
            return "Add a business or life area before saving."
        }
        if normalizedDueDate != nil && !Self.isValidDate(normalizedDueDate) {
            return "Due date must use YYYY-MM-DD."
        }
        if normalizedReviewDate != nil && !Self.isValidDate(normalizedReviewDate) {
            return "Review date must use YYYY-MM-DD."
        }
        return nil
    }

    var normalizedTitle: String { title.trimmed }
    var normalizedBusiness: String { business.trimmed }
    var normalizedDescription: String? { description.nilIfBlank }
    var normalizedNotes: String? { notes.nilIfBlank }
    var normalizedDueDate: String? { dueDate.nilIfBlank }
    var normalizedReviewDate: String? { reviewDate.nilIfBlank }
    var normalizedNextAction: String? { nextAction.nilIfBlank }
    var normalizedDefinitionOfDone: String? { definitionOfDone.nilIfBlank }
    var normalizedWorkMode: String? { workMode.nilIfBlank }
    var normalizedApprovalState: String? { approvalState.nilIfBlank }
    var normalizedOwners: [String] { Self.splitList(ownersText) }
    var normalizedTags: [String] { Self.splitList(tagsText) }

    private static func splitList(_ value: String) -> [String] {
        value
            .split(separator: ",")
            .map { String($0).trimmed }
            .filter { !$0.isEmpty }
    }

    private static func isValidDate(_ value: String?) -> Bool {
        guard let value else { return true }
        return dateFormatter.date(from: value) != nil
    }

    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()
}

extension String {
    var nilIfBlank: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    var trimmed: String {
        trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

struct AtlasRootView: View {
    @EnvironmentObject private var store: AtlasStore

    var body: some View {
        TabView {
            FocusView()
                .tabItem { Label("Today", systemImage: "sun.max") }

            ActionsView()
                .tabItem { Label("Actions", systemImage: "square.grid.2x2") }

            ReviewView()
                .tabItem { Label("Review", systemImage: "person.crop.circle.badge.checkmark") }

            CalendarView()
                .tabItem { Label("Calendar", systemImage: "calendar") }

            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape") }
        }
        .tint(AtlasStyle.accent)
        .background(AtlasStyle.background.ignoresSafeArea())
    }
}

extension View {
    func atlasCard(cornerRadius: CGFloat = 14) -> some View {
        self
            .background(AtlasStyle.card)
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(AtlasStyle.border, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
    }
}

struct ActionsView: View {
    @EnvironmentObject private var store: AtlasStore
    @State private var showingSettings = false
    @State private var showingAddAction = false

    var body: some View {
        NavigationView {
            AtlasScreen(state: store.state, protectedSurface: .actions, retry: { await store.load() }) {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 14) {
                        AtlasSearchHeader()
                        DashboardMetricGrid(actions: store.actions)
                        ProtocolChipCloud(actions: store.actions)
                        BusinessChipRow(actions: store.activeActions)
                        FilterControlGrid()

                        LazyVStack(spacing: 10) {
                            ForEach(store.activeActions.prefix(12)) { action in
                                NavigationLink(destination: ActionDetailView(action: action)) {
                                    DashboardActionCard(action: action)
                                }
                                .buttonStyle(.plain)
                            }
                        }

                        if store.activeActions.isEmpty {
                            EmptyNativeState(title: "No active actions", message: "Atlas will show active, review, and blocked work here after the protected API feed loads.")
                        }
                    }
                    .padding(16)
                    .padding(.bottom, 132)
                }
                .refreshable {
                    await store.load()
                }
            }
            .navigationTitle("Dashboard")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showingAddAction = true
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel("Add Atlas action")
                }
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showingSettings = true
                    } label: {
                        Image(systemName: "gearshape")
                    }
                    .accessibilityLabel("Open settings")
                }
            }
            .sheet(isPresented: $showingSettings) {
                SettingsView()
            }
            .sheet(isPresented: $showingAddAction) {
                AddActionView()
                    .environmentObject(store)
            }
        }
    }
}

struct FocusView: View {
    @EnvironmentObject private var store: AtlasStore

    var body: some View {
        NavigationView {
            AtlasScreen(state: store.state, protectedSurface: .today, retry: { await store.load() }) {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 16) {
                        TodayNativeHeader(totalFocus: store.onFireActions.count + store.dueTodayActions.count + store.reviewRequiredActions.count + store.inProgressActions.count)
                        AtlasSyncStatusStrip()
                        AtlasPrimaryExecutionCard(action: store.primaryExecutionAction)
                        AtlasExecutionFilterStrip(
                            active: store.activeActions.count,
                            blocked: store.blockedActions.count,
                            dueSoon: store.dueSoonActions.count
                        )
                        TodayMetricGrid(
                            overdue: store.activeActions.filter(\.isOverdue).count,
                            dueToday: store.activeActions.filter(\.isDueToday).count,
                            active: store.activeActions.filter(\.isActiveWork).count,
                            review: store.reviewActions.count
                        )

                        TodayActionSection(
                            title: "On Fire",
                            subtitle: "P0 actions and overdue items",
                            symbol: "flame.fill",
                            tone: AtlasStyle.danger,
                            actions: store.onFireActions,
                            emptyMessage: "No P0 or overdue actions."
                        )

                        TodayActionSection(
                            title: "Due Today",
                            subtitle: "Items with today's due date",
                            symbol: "clock.fill",
                            tone: AtlasStyle.accent,
                            actions: store.dueTodayActions,
                            emptyMessage: "Nothing due today."
                        )

                        TodayActionSection(
                            title: "Review",
                            subtitle: "User-only and approval-gated work",
                            symbol: "person.crop.circle.badge.checkmark",
                            tone: AtlasStyle.purple,
                            actions: store.reviewRequiredActions,
                            emptyMessage: "Review queue is clear."
                        )

                        TodayActionSection(
                            title: "In Progress",
                            subtitle: "Active work already moving",
                            symbol: "play.circle.fill",
                            tone: AtlasStyle.blue,
                            actions: store.inProgressActions.filter { $0.id != store.primaryExecutionAction?.id },
                            emptyMessage: "No active in-progress work."
                        )

                        TodayActionSection(
                            title: "Up Next",
                            subtitle: "Pull from here when urgent work is quiet",
                            symbol: "arrow.right.circle.fill",
                            tone: AtlasStyle.success,
                            actions: Array(store.upNextActions.filter { $0.id != store.primaryExecutionAction?.id }.prefix(10)),
                            emptyMessage: "No up-next actions loaded."
                        )
                    }
                    .padding()
                    .padding(.bottom, 132)
                }
                .refreshable {
                    await store.load()
                }
            }
            .navigationTitle("Today")
        }
    }
}

struct TodayNativeHeader: View {
    let totalFocus: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(greeting.uppercased())
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(AtlasStyle.mutedText)
            Text(todayFormatted)
                .font(.title2.weight(.bold))
                .foregroundStyle(AtlasStyle.primaryText)
            Text(totalFocus == 0 ? "Nothing urgent. Pull from Up Next or take a break." : "\(totalFocus) action\(totalFocus == 1 ? "" : "s") need\(totalFocus == 1 ? "s" : "") attention today.")
                .font(.subheadline)
                .foregroundStyle(AtlasStyle.secondaryText)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var greeting: String {
        let hour = Calendar.current.component(.hour, from: Date())
        if hour < 12 { return "Good morning" }
        if hour < 17 { return "Good afternoon" }
        return "Good evening"
    }

    private var todayFormatted: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEEE, MMMM d"
        return formatter.string(from: Date())
    }
}

struct AtlasSyncStatusStrip: View {
    @EnvironmentObject private var store: AtlasStore
    @EnvironmentObject private var supabaseSession: NativeSupabaseSession

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon)
                .font(.subheadline.weight(.bold))
                .foregroundStyle(tone)
                .frame(width: 30, height: 30)
                .background(tone.opacity(0.13), in: RoundedRectangle(cornerRadius: 8, style: .continuous))

            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(AtlasStyle.primaryText)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(AtlasStyle.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 8)

            Text(store.syncStatus.pendingWrites == 0 ? "0 pending" : "\(store.syncStatus.pendingWrites) pending")
                .font(.caption2.weight(.bold))
                .foregroundStyle(tone)
                .lineLimit(1)
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .background(tone.opacity(0.12), in: Capsule())
        }
        .padding(12)
        .background(AtlasStyle.panel, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(AtlasStyle.border, lineWidth: 1))
    }

    private var title: String {
        if store.state == .loading { return "Refreshing Atlas" }
        if supabaseSession.isAuthenticated && store.syncStatus.lastError == nil { return "Live Supabase session" }
        if supabaseSession.refreshTokenAvailable && !supabaseSession.isAuthenticated { return "Saved session locked" }
        if store.syncStatus.lastError != nil { return "Cached recovery mode" }
        return "Sign in required"
    }

    private var detail: String {
        if let lastError = store.syncStatus.lastError {
            return "\(store.syncStatus.summary). Last recovery issue: \(lastError)"
        }
        return store.writeReadinessMessage
    }

    private var icon: String {
        if store.state == .loading { return "arrow.triangle.2.circlepath" }
        if store.syncStatus.lastError != nil { return "exclamationmark.triangle.fill" }
        if supabaseSession.isAuthenticated { return "checkmark.seal.fill" }
        return "lock.fill"
    }

    private var tone: Color {
        if store.syncStatus.lastError != nil { return AtlasStyle.warning }
        if supabaseSession.isAuthenticated { return AtlasStyle.success }
        return AtlasStyle.mutedText
    }
}

struct AtlasPrimaryExecutionCard: View {
    @EnvironmentObject private var store: AtlasStore
    let action: AtlasAction?
    @State private var showingCapture = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "scope")
                    .font(.headline.weight(.semibold))
                    .foregroundStyle(commandTone)
                    .frame(width: 36, height: 36)
                    .background(commandTone.opacity(0.14), in: RoundedRectangle(cornerRadius: 10, style: .continuous))

                VStack(alignment: .leading, spacing: 5) {
                    Text("Next execution")
                        .font(.headline.weight(.semibold))
                        .foregroundStyle(AtlasStyle.primaryText)
                    Text(action?.title ?? "No executable Atlas action loaded")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(AtlasStyle.primaryText)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(action?.primaryDetail ?? "Refresh after sign-in to load the live Atlas execution queue.")
                        .font(.subheadline)
                        .lineSpacing(3)
                        .foregroundStyle(AtlasStyle.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 8)

                Text(action.map { "r\($0.revision)" } ?? "No row")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(commandTone)
                    .lineLimit(1)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 5)
                    .background(commandTone.opacity(0.12), in: Capsule())
            }

            if let message = store.mutationMessage {
                AtlasCommandFeedback(message: message)
            }

            AtlasEvidenceExpectationRow(action: action)

            if let action {
                VStack(spacing: 10) {
                    Button {
                        Task { await store.transition(action, to: primaryStatus) }
                    } label: {
                        Label(primaryLabel, systemImage: primaryIcon)
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(AtlasActionButtonStyle(tone: primaryTone))
                    .disabled(primaryDisabled)

                    HStack(spacing: 8) {
                        Button {
                            Task { await store.transition(action, to: "in_progress") }
                        } label: {
                            Label("Start", systemImage: "play.fill")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(AtlasActionButtonStyle(tone: AtlasStyle.blue, filled: false))
                        .disabled(!store.writesEnabled || action.isDone || action.isBlocked || action.isActiveWork)

                        Button {
                            Task { await store.transition(action, to: "done") }
                        } label: {
                            Label("Done", systemImage: "checkmark")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(AtlasActionButtonStyle(tone: AtlasStyle.success, filled: false))
                        .disabled(!store.writesEnabled || action.isDone)
                    }

                    HStack(spacing: 8) {
                        Button {
                            Task { await store.transition(action, to: "blocked") }
                        } label: {
                            Label("Block", systemImage: "exclamationmark.triangle.fill")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(AtlasActionButtonStyle(tone: AtlasStyle.warning, filled: false))
                        .disabled(!store.writesEnabled || action.isDone || action.isBlocked)

                        Button {
                            showingCapture = true
                        } label: {
                            Label("Capture", systemImage: "square.and.pencil")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(AtlasActionButtonStyle(tone: AtlasStyle.accent, filled: false))
                        .disabled(!store.writesEnabled || action.isDone)
                    }
                }
                .sheet(isPresented: $showingCapture) {
                    AtlasCaptureSheet(action: action)
                        .environmentObject(store)
                }
            } else {
                Button {
                    Task { await store.load() }
                } label: {
                    Label("Refresh Atlas", systemImage: "arrow.clockwise")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(AtlasActionButtonStyle(tone: AtlasStyle.accent, filled: false))
            }
        }
        .padding()
        .atlasCard(cornerRadius: 12)
    }

    private var primaryStatus: String {
        guard let action else { return "in_progress" }
        return action.isActiveWork ? "done" : "in_progress"
    }

    private var primaryLabel: String {
        guard let action else { return "Start" }
        return action.isActiveWork ? "Done" : "Start"
    }

    private var primaryIcon: String {
        primaryStatus == "done" ? "checkmark.circle.fill" : "play.circle.fill"
    }

    private var primaryTone: Color {
        primaryStatus == "done" ? AtlasStyle.success : AtlasStyle.blue
    }

    private var primaryDisabled: Bool {
        guard let action else { return true }
        return !store.writesEnabled || action.isDone || action.isBlocked
    }

    private var commandTone: Color {
        guard let action else { return AtlasStyle.warning }
        if action.isBlocked { return AtlasStyle.warning }
        if action.isOverdue { return AtlasStyle.danger }
        if action.needsReview { return AtlasStyle.purple }
        return AtlasStyle.accent
    }
}

struct AtlasEvidenceExpectationRow: View {
    @EnvironmentObject private var store: AtlasStore
    let action: AtlasAction?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            AtlasRunwayRow(
                label: "Write",
                title: action.map { "atlas_actions status, \($0.statusLabel)" } ?? "No row selected",
                detail: store.writeReadinessMessage,
                value: action.map { "r\($0.revision)" } ?? "--",
                tone: store.writesEnabled ? AtlasStyle.success : AtlasStyle.warning,
                symbol: "lock.shield.fill"
            )
            AtlasRunwayRow(
                label: "Evidence",
                title: "Activity row expected",
                detail: "Status changes and captures append atlas_activity_log evidence; stale revisions are rejected.",
                value: "log",
                tone: AtlasStyle.accent,
                symbol: "list.bullet.clipboard.fill"
            )
        }
    }
}

struct AtlasCommandFeedback: View {
    let message: String

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: icon)
                .font(.caption.weight(.bold))
                .foregroundStyle(tone)
            Text(message)
                .font(.caption.weight(.semibold))
                .foregroundStyle(tone)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tone.opacity(0.11), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private var icon: String {
        let lowered = message.lowercased()
        if lowered.contains("changed elsewhere") || lowered.contains("conflict") { return "arrow.triangle.2.circlepath" }
        if lowered.contains("not saved") || lowered.contains("needs retry") || lowered.contains("failed") { return "exclamationmark.triangle.fill" }
        if lowered.contains("saved") || lowered.contains("updated") { return "checkmark.circle.fill" }
        return "info.circle.fill"
    }

    private var tone: Color {
        let lowered = message.lowercased()
        if lowered.contains("changed elsewhere") || lowered.contains("needs retry") || lowered.contains("failed") || lowered.contains("not saved") {
            return AtlasStyle.warning
        }
        if lowered.contains("saved") || lowered.contains("updated") {
            return AtlasStyle.success
        }
        return AtlasStyle.accent
    }
}

struct AtlasExecutionFilterStrip: View {
    let active: Int
    let blocked: Int
    let dueSoon: Int

    var body: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
            AtlasExecutionFilterTile(label: "Active", value: active, symbol: "play.circle.fill", tone: AtlasStyle.blue)
            AtlasExecutionFilterTile(label: "Blocked", value: blocked, symbol: "exclamationmark.triangle.fill", tone: blocked > 0 ? AtlasStyle.warning : AtlasStyle.mutedText)
            AtlasExecutionFilterTile(label: "Due soon", value: dueSoon, symbol: "calendar.badge.clock", tone: dueSoon > 0 ? AtlasStyle.accent : AtlasStyle.mutedText)
        }
    }
}

struct AtlasExecutionFilterTile: View {
    let label: String
    let value: Int
    let symbol: String
    let tone: Color

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: symbol)
                .font(.caption.weight(.bold))
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.caption.weight(.semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.78)
                Text("\(value)")
                    .font(.headline.weight(.bold))
            }
            Spacer(minLength: 0)
        }
        .foregroundStyle(tone)
        .frame(minHeight: 48)
        .padding(.horizontal, 10)
        .background(AtlasStyle.cardRaised, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(AtlasStyle.border, lineWidth: 1))
    }
}

struct AtlasCaptureSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: AtlasStore
    let action: AtlasAction
    @State private var note = ""

    var body: some View {
        NavigationView {
            VStack(alignment: .leading, spacing: 14) {
                Text(action.title)
                    .font(.headline.weight(.semibold))
                    .foregroundStyle(AtlasStyle.primaryText)
                    .fixedSize(horizontal: false, vertical: true)

                Text("Capture a short execution note. It will be saved as Atlas activity evidence for this action.")
                    .font(.subheadline)
                    .foregroundStyle(AtlasStyle.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)

                TextEditor(text: $note)
                    .frame(minHeight: 150)
                    .padding(10)
                    .background(AtlasStyle.cardRaised, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(AtlasStyle.border, lineWidth: 1))

                if let message = store.mutationMessage {
                    AtlasCommandFeedback(message: message)
                }

                Spacer(minLength: 0)
            }
            .padding(16)
            .background(AtlasStyle.background.ignoresSafeArea())
            .navigationTitle("Capture Evidence")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            await store.captureEvidence(action, note: note)
                            if store.mutationMessage?.lowercased().contains("saved") == true {
                                dismiss()
                            }
                        }
                    }
                    .disabled(note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !store.writesEnabled)
                }
            }
        }
    }
}

struct AtlasTodayCommandPanel: View {
    @EnvironmentObject private var store: AtlasStore
    let actions: [AtlasAction]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "point.topleft.down.curvedto.point.bottomright.up")
                    .font(.headline.weight(.semibold))
                    .foregroundStyle(commandTone)
                    .frame(width: 34, height: 34)
                    .background(commandTone.opacity(0.14), in: RoundedRectangle(cornerRadius: 9, style: .continuous))

                VStack(alignment: .leading, spacing: 5) {
                    Text("Command")
                        .font(.headline.weight(.semibold))
                        .foregroundStyle(AtlasStyle.primaryText)
                    Text(commandTitle)
                        .font(.subheadline)
                        .lineSpacing(3)
                        .foregroundStyle(AtlasStyle.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 8)

                Text(nextAction.map { "r\($0.revision)" } ?? "No row")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(AtlasStyle.mutedText)
                    .lineLimit(1)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 5)
                    .background(AtlasStyle.cardRaised, in: Capsule())
            }

            if let message = store.mutationMessage {
                Text(message)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(AtlasStyle.accent)
                    .fixedSize(horizontal: false, vertical: true)
            }

            VStack(spacing: 10) {
                AtlasCommandLine(symbol: "play.circle.fill", label: "Now", title: nowTitle, detail: nowDetail, tone: commandTone)
                AtlasCommandLine(symbol: "person.crop.circle.badge.checkmark", label: "Review", title: reviewTitle, detail: reviewDetail, tone: AtlasStyle.purple)
                AtlasCommandLine(symbol: "exclamationmark.triangle.fill", label: "Hold", title: holdTitle, detail: holdDetail, tone: AtlasStyle.warning)
            }

            if let action = nextAction {
                HStack(spacing: 10) {
                    Button {
                        Task { await store.transition(action, to: "in_progress") }
                    } label: {
                        Label("Start", systemImage: "play.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(AtlasActionButtonStyle(tone: AtlasStyle.blue))
                    .disabled(action.isDone || action.isBlocked)

                    Button {
                        Task { await store.transition(action, to: "done") }
                    } label: {
                        Label("Done", systemImage: "checkmark")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(AtlasActionButtonStyle(tone: AtlasStyle.success))
                    .disabled(action.isDone)
                }

                Button {
                    Task { await store.transition(action, to: "blocked") }
                } label: {
                    Label("Route blocker", systemImage: "exclamationmark.triangle.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(AtlasActionButtonStyle(tone: AtlasStyle.warning, filled: false))
                .disabled(action.isDone || action.isBlocked)
            } else {
                Button {
                    Task { await store.load() }
                } label: {
                    Label("Refresh Atlas", systemImage: "arrow.clockwise")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(AtlasActionButtonStyle(tone: AtlasStyle.accent, filled: false))
            }
        }
        .padding()
        .atlasCard()
    }

    private var nextAction: AtlasAction? {
        actions.first { !$0.isDone && !$0.isBlocked } ?? actions.first { !$0.isDone }
    }

    private var reviewAction: AtlasAction? {
        actions.first { $0.needsReview }
    }

    private var blockedAction: AtlasAction? {
        actions.first { $0.isBlocked || !$0.blockedBy.isEmpty }
    }

    private var commandTitle: String {
        guard let action = nextAction else { return "Load Atlas, then execute one action." }
        if action.needsReview { return "Resolve review before execution expands." }
        if action.isBlocked { return "Route the blocker before touching the backlog." }
        return action.title
    }

    private var nowTitle: String {
        nextAction?.title ?? "No executable action loaded"
    }

    private var nowDetail: String {
        guard let action = nextAction else { return "Refresh after sign-in to load the live Atlas action queue." }
        return action.primaryDetail
    }

    private var reviewTitle: String {
        reviewAction?.title ?? "No review-gated action at top"
    }

    private var reviewDetail: String {
        guard let action = reviewAction else { return "User-only and approval-gated work remains separate from execution." }
        return action.approvalState?.nilIfBlank ?? action.workModeLabel
    }

    private var holdTitle: String {
        blockedAction?.title ?? "Do not browse the backlog first"
    }

    private var holdDetail: String {
        if let action = blockedAction {
            return action.blockedBy.isEmpty ? action.primaryDetail : action.blockedBy.joined(separator: ", ")
        }
        return "Start, finish, or block the command action before widening scope."
    }

    private var commandTone: Color {
        guard let action = nextAction else { return AtlasStyle.warning }
        if action.isBlocked { return AtlasStyle.warning }
        if action.isOverdue { return AtlasStyle.danger }
        if action.needsReview { return AtlasStyle.purple }
        return AtlasStyle.accent
    }
}

struct AtlasExecutionRunway: View {
    @EnvironmentObject private var store: AtlasStore
    let actions: [AtlasAction]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "slider.horizontal.3")
                    .font(.headline.weight(.semibold))
                    .foregroundStyle(runwayTone)
                    .frame(width: 34, height: 34)
                    .background(runwayTone.opacity(0.14), in: RoundedRectangle(cornerRadius: 9, style: .continuous))

                VStack(alignment: .leading, spacing: 5) {
                    Text("Execution runway")
                        .font(.headline.weight(.semibold))
                        .foregroundStyle(AtlasStyle.primaryText)
                    Text(runwayTitle)
                        .font(.subheadline)
                        .lineSpacing(3)
                        .foregroundStyle(AtlasStyle.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 8)

                Text(nextAction.map { $0.priorityLabel } ?? "Empty")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(runwayTone)
                    .lineLimit(1)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 5)
                    .background(runwayTone.opacity(0.12), in: Capsule())
            }

            VStack(spacing: 10) {
                AtlasRunwayRow(label: "Write target", title: writeTargetTitle, detail: writeTargetDetail, value: writeTargetValue, tone: runwayTone, symbol: "square.and.pencil")
                AtlasRunwayRow(label: "Done means", title: doneTitle, detail: doneDetail, value: doneValue, tone: AtlasStyle.success, symbol: "checkmark.seal.fill")
                AtlasRunwayRow(label: "Blocked by", title: blockerTitle, detail: blockerDetail, value: blockerValue, tone: blockerTone, symbol: "exclamationmark.triangle.fill")
            }

            if let message = store.mutationMessage {
                Text(message)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(AtlasStyle.accent)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let action = nextAction {
                VStack(spacing: 10) {
                    HStack(spacing: 10) {
                        Button {
                            Task { await store.transition(action, to: "in_progress") }
                        } label: {
                            Label("Start target", systemImage: "play.fill")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(AtlasActionButtonStyle(tone: AtlasStyle.blue))
                        .disabled(action.isDone || action.isBlocked)

                        Button {
                            Task { await store.transition(action, to: "done") }
                        } label: {
                            Label("Mark done", systemImage: "checkmark")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(AtlasActionButtonStyle(tone: AtlasStyle.success))
                        .disabled(action.isDone)
                    }

                    Button {
                        Task { await store.transition(action, to: "blocked") }
                    } label: {
                        Label("Route blocker", systemImage: "exclamationmark.triangle.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(AtlasActionButtonStyle(tone: AtlasStyle.warning, filled: false))
                    .disabled(action.isDone || action.isBlocked)
                }
            }
        }
        .padding()
        .atlasCard()
    }

    private var nextAction: AtlasAction? {
        actions.first { !$0.isDone && !$0.isBlocked } ?? actions.first { !$0.isDone }
    }

    private var blockedAction: AtlasAction? {
        actions.first { $0.isBlocked || !$0.blockedBy.isEmpty }
    }

    private var runwayTitle: String {
        guard let action = nextAction else { return "Refresh Atlas to load the next executable action." }
        if action.isBlocked { return "Blocked action is visible; route the obstacle before expanding scope." }
        if action.needsReview { return "Review-gated action is next; decide before marking execution complete." }
        return "One action gets the next status write. Finish or block it before opening the backlog."
    }

    private var writeTargetTitle: String {
        nextAction?.title ?? "No action selected"
    }

    private var writeTargetDetail: String {
        guard let action = nextAction else { return "No live Atlas row is selected yet." }
        let source = action.updatedSource?.nilIfBlank ?? "unknown source"
        let updated = action.updatedAt?.nilIfBlank ?? "no timestamp"
        return "\(action.statusLabel), \(source), \(updated)"
    }

    private var writeTargetValue: String {
        nextAction.map { "r\($0.revision)" } ?? "--"
    }

    private var doneTitle: String {
        nextAction?.completionProof ?? "No definition of done"
    }

    private var doneDetail: String {
        guard let action = nextAction else { return "Completion proof appears after Atlas loads an action row." }
        return action.primaryDetail
    }

    private var doneValue: String {
        nextAction?.isDone == true ? "done" : "open"
    }

    private var blockerTitle: String {
        blockedAction?.title ?? "No blocker at top"
    }

    private var blockerDetail: String {
        guard let action = blockedAction else { return "Keep it this way: finish the target or route a blocker instead of browsing." }
        return action.blockedBy.isEmpty ? action.primaryDetail : action.blockedBy.joined(separator: ", ")
    }

    private var blockerValue: String {
        blockedAction == nil ? "clear" : "hold"
    }

    private var blockerTone: Color {
        blockedAction == nil ? AtlasStyle.success : AtlasStyle.warning
    }

    private var runwayTone: Color {
        guard let action = nextAction else { return AtlasStyle.warning }
        if action.isBlocked { return AtlasStyle.warning }
        if action.isOverdue { return AtlasStyle.danger }
        if action.needsReview { return AtlasStyle.purple }
        return AtlasStyle.accent
    }
}

struct AtlasRunwayRow: View {
    let label: String
    let title: String
    let detail: String
    let value: String
    let tone: Color
    let symbol: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: symbol)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(tone)
                .frame(width: 28, height: 28)
                .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: 8, style: .continuous))

            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(label)
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(tone)
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(AtlasStyle.primaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text(detail)
                    .font(.caption)
                    .lineSpacing(2)
                    .foregroundStyle(AtlasStyle.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 8)

            Text(value)
                .font(.caption.weight(.bold))
                .foregroundStyle(tone)
                .lineLimit(1)
                .minimumScaleFactor(0.72)
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .background(tone.opacity(0.12), in: Capsule())
        }
        .padding(12)
        .background(AtlasStyle.cardRaised, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(AtlasStyle.border, lineWidth: 1))
    }
}

struct AtlasCommandLine: View {
    let symbol: String
    let label: String
    let title: String
    let detail: String
    let tone: Color

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: symbol)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(tone)
                .frame(width: 28, height: 28)
                .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: 8, style: .continuous))

            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(label)
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(tone)
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(AtlasStyle.primaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text(detail)
                    .font(.caption)
                    .lineSpacing(2)
                    .foregroundStyle(AtlasStyle.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
    }
}

struct TodayFocusBriefing: View {
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "target")
                .font(.headline.weight(.bold))
                .foregroundStyle(AtlasStyle.accent)
                .frame(width: 34, height: 34)
                .background(AtlasStyle.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 9, style: .continuous))

            VStack(alignment: .leading, spacing: 4) {
                Text("Today's focus")
                    .font(.headline.weight(.semibold))
                    .foregroundStyle(AtlasStyle.primaryText)
                Text("Review urgent, due, and user-gated work before browsing the backlog. Native writes are limited to revision-checked status changes with activity evidence.")
                    .font(.subheadline)
                    .foregroundStyle(AtlasStyle.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(14)
        .atlasCard(cornerRadius: 12)
    }
}

struct TodayNativeFilters: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "slider.horizontal.3")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(AtlasStyle.secondaryText)
                Text("Filters")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(AtlasStyle.primaryText)
                Spacer()
            }

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                TodayFilterToken(label: "Urgent (P0)", symbol: "flame.fill", active: true, tone: AtlasStyle.danger)
                TodayFilterToken(label: "Overdue", symbol: "exclamationmark.triangle.fill", active: false, tone: AtlasStyle.danger)
                TodayFilterToken(label: "Review", symbol: "person.crop.circle.badge.checkmark", active: false, tone: AtlasStyle.purple)
                TodayFilterToken(label: "Work mode", symbol: "briefcase.fill", active: false, tone: AtlasStyle.blue)
            }
        }
        .padding(14)
        .atlasCard(cornerRadius: 12)
    }
}

struct TodayFilterToken: View {
    let label: String
    let symbol: String
    let active: Bool
    let tone: Color

    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: symbol)
                .font(.caption2.weight(.bold))
            Text(label.uppercased())
                .font(.system(size: 10, weight: .bold))
                .lineLimit(1)
                .minimumScaleFactor(0.78)
            Spacer(minLength: 0)
        }
        .foregroundStyle(active ? tone : AtlasStyle.secondaryText)
        .padding(.horizontal, 10)
        .frame(height: 34)
        .background(active ? tone.opacity(0.12) : AtlasStyle.cardRaised, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .stroke(active ? tone.opacity(0.3) : AtlasStyle.border, lineWidth: 1)
        )
    }
}

struct TodayMetricGrid: View {
    let overdue: Int
    let dueToday: Int
    let active: Int
    let review: Int

    var body: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
            TodayMetricTile(label: "Overdue", value: overdue, tone: overdue > 0 ? AtlasStyle.danger : AtlasStyle.mutedText)
            TodayMetricTile(label: "Due Today", value: dueToday, tone: dueToday > 0 ? AtlasStyle.accent : AtlasStyle.mutedText)
            TodayMetricTile(label: "Active", value: active, tone: active > 0 ? AtlasStyle.blue : AtlasStyle.mutedText)
            TodayMetricTile(label: "Review", value: review, tone: review > 0 ? AtlasStyle.accent : AtlasStyle.mutedText)
        }
    }
}

struct TodayMetricTile: View {
    let label: String
    let value: Int
    let tone: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label.uppercased())
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(AtlasStyle.secondaryText)
            Text("\(value)")
                .font(.system(size: 30, weight: .bold))
                .foregroundStyle(tone)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .atlasCard(cornerRadius: 14)
    }
}

struct TodayActionSection: View {
    let title: String
    let subtitle: String
    let symbol: String
    let tone: Color
    let actions: [AtlasAction]
    let emptyMessage: String

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: symbol)
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(tone)
                    .frame(width: 30, height: 30)
                    .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 8) {
                        Text(title)
                            .font(.headline.weight(.semibold))
                            .foregroundStyle(AtlasStyle.primaryText)
                        Text("\(actions.count)")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(tone)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 3)
                            .background(tone.opacity(0.12), in: Capsule())
                    }
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(AtlasStyle.secondaryText)
                }
                Spacer(minLength: 0)
            }

            if actions.isEmpty {
                Text(emptyMessage)
                    .font(.subheadline)
                    .foregroundStyle(AtlasStyle.mutedText)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.leading, 40)
            } else {
                LazyVStack(spacing: 10) {
                    ForEach(actions) { action in
                        NavigationLink(destination: ActionDetailView(action: action)) {
                            FocusCard(action: action)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }
}

struct ReviewView: View {
    @EnvironmentObject private var store: AtlasStore

    var body: some View {
        NavigationView {
            AtlasScreen(state: store.state, protectedSurface: .review, retry: { await store.load() }) {
                List {
                    if store.reviewActions.isEmpty {
                        EmptyNativeState(title: "Review queue clear", message: "Review-required, user-only, and pending approval actions will appear here.")
                            .listRowBackground(AtlasStyle.card)
                    } else {
                        ForEach(store.reviewActions) { action in
                            NavigationLink(destination: ActionDetailView(action: action)) {
                                ReviewRow(action: action)
                            }
                            .listRowBackground(AtlasStyle.card)
                        }
                    }
                }
                .background(AtlasStyle.background)
                .refreshable {
                    await store.load()
                }
            }
            .navigationTitle("Review")
        }
    }
}

struct KanbanView: View {
    @EnvironmentObject private var store: AtlasStore

    var body: some View {
        NavigationView {
            AtlasScreen(state: store.state, protectedSurface: .actions, retry: { await store.load() }) {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        KanbanLane(title: "Active", actions: store.activeActions.filter { !$0.isBlocked && !$0.needsReview })
                        KanbanLane(title: "Pending review", actions: store.reviewActions)
                        KanbanLane(title: "Blocked", actions: store.activeActions.filter(\.isBlocked))
                    }
                    .padding()
                    .padding(.bottom, 132)
                }
                .refreshable {
                    await store.load()
                }
            }
            .navigationTitle("Kanban")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

struct CalendarView: View {
    @EnvironmentObject private var store: AtlasStore

    var datedActions: [AtlasAction] {
        store.activeActions
            .filter { $0.dueDate?.nilIfBlank != nil || $0.reviewDate?.nilIfBlank != nil }
            .sorted(by: AtlasAction.sortForFocus)
    }

    var body: some View {
        NavigationView {
            AtlasScreen(state: store.state, protectedSurface: .calendar, retry: { await store.load() }) {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 10) {
                        DateScopeHeader(actions: store.activeActions)

                        if datedActions.isEmpty {
                            EmptyNativeState(title: "No dated actions", message: "Due dates and review dates will appear here after the protected Atlas feed loads.")
                        } else {
                            ForEach(datedActions.prefix(20)) { action in
                                NavigationLink(destination: ActionDetailView(action: action)) {
                                    CalendarActionRow(action: action)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                    .padding()
                    .padding(.bottom, 132)
                }
                .refreshable {
                    await store.load()
                }
            }
            .navigationTitle("Calendar")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

struct AddActionView: View {
    @EnvironmentObject private var store: AtlasStore
    @State private var draft = AtlasActionDraft()

    var body: some View {
        NavigationView {
            AtlasScreen(state: store.state, protectedSurface: .actions, retry: { await store.load() }) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: "plus.circle.fill")
                                .font(.title2.weight(.semibold))
                                .foregroundStyle(AtlasStyle.accent)
                                .frame(width: 36, height: 36)
                                .background(AtlasStyle.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 9, style: .continuous))

                            VStack(alignment: .leading, spacing: 4) {
                                Text("New action")
                                    .font(.title2.weight(.bold))
                                    .foregroundStyle(AtlasStyle.primaryText)
                                Text("Create a focused Atlas row with enough context to act on it later.")
                                    .font(.subheadline)
                                    .foregroundStyle(AtlasStyle.secondaryText)
                            }
                        }

                        AtlasActionDraftForm(draft: $draft, mode: .create)

                        if let message = store.mutationMessage {
                            AtlasCommandFeedback(message: message)
                        }

                        Button {
                            Task { await store.createAction(draft) }
                        } label: {
                            Label("Create action", systemImage: "plus")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(AtlasActionButtonStyle(tone: AtlasStyle.accent))
                        .disabled(!store.writesEnabled || !draft.isValid)
                    }
                    .padding(16)
                    .padding(.bottom, 132)
                }
            }
            .navigationTitle("Add")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

enum AtlasActionDraftFormMode {
    case create
    case edit
}

struct AtlasActionDraftForm: View {
    @Binding var draft: AtlasActionDraft
    let mode: AtlasActionDraftFormMode

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            AtlasFormSection(title: "Required") {
                AtlasTextInput(label: "Title", placeholder: "What needs to happen?", text: $draft.title)
                AtlasTextInput(label: "Business", placeholder: "AEGIS, Finance, Personal OS", text: $draft.business)
            }

            AtlasFormSection(title: "Execution") {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Priority")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(AtlasStyle.secondaryText)
                    Picker("Priority", selection: $draft.priority) {
                        Text("P0").tag("p0")
                        Text("P1").tag("p1")
                        Text("P2").tag("p2")
                        Text("P3").tag("p3")
                    }
                    .pickerStyle(.segmented)
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("Status")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(AtlasStyle.secondaryText)
                    Picker("Status", selection: $draft.status) {
                        Text("New").tag("not_started")
                        Text("Active").tag("in_progress")
                        Text("Blocked").tag("blocked")
                    }
                    .pickerStyle(.segmented)
                }

                AtlasMultilineInput(label: "Next action", placeholder: "The next concrete move", text: $draft.nextAction)
                AtlasMultilineInput(label: "Done means", placeholder: "What proof makes this complete?", text: $draft.definitionOfDone)
            }

            AtlasFormSection(title: "Details") {
                AtlasTextInput(label: "Due date", placeholder: "YYYY-MM-DD", text: $draft.dueDate)
                    .keyboardType(.numbersAndPunctuation)
                AtlasTextInput(label: "Review date", placeholder: "YYYY-MM-DD", text: $draft.reviewDate)
                    .keyboardType(.numbersAndPunctuation)
                AtlasTextInput(label: "Owners", placeholder: "Comma separated", text: $draft.ownersText)
                AtlasTextInput(label: "Tags", placeholder: "Comma separated", text: $draft.tagsText)
            }

            AtlasFormSection(title: "Notes") {
                AtlasMultilineInput(label: "Description", placeholder: "Background or constraints", text: $draft.description)
                AtlasMultilineInput(label: "Notes", placeholder: "Private working notes", text: $draft.notes)
            }

            if let validation = draft.validationMessage {
                AtlasCommandFeedback(message: validation)
            } else if mode == .edit {
                Text("Edits use the current row revision. If web or agent updates land first, Atlas asks you to refresh.")
                    .font(.caption)
                    .foregroundStyle(AtlasStyle.secondaryText)
            }
        }
    }
}

struct AtlasFormSection<Content: View>: View {
    let title: String
    let content: Content

    init(title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.headline.weight(.semibold))
                .foregroundStyle(AtlasStyle.primaryText)
            VStack(alignment: .leading, spacing: 10) {
                content
            }
        }
        .padding()
        .atlasCard(cornerRadius: 12)
    }
}

struct AtlasTextInput: View {
    let label: String
    let placeholder: String
    @Binding var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(AtlasStyle.secondaryText)
            TextField(placeholder, text: $text)
                .font(.body)
                .foregroundStyle(AtlasStyle.primaryText)
                .textInputAutocapitalization(.sentences)
                .padding(.horizontal, 12)
                .frame(minHeight: 46)
                .background(AtlasStyle.cardRaised, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(AtlasStyle.border, lineWidth: 1))
        }
    }
}

struct AtlasMultilineInput: View {
    let label: String
    let placeholder: String
    @Binding var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(AtlasStyle.secondaryText)
            ZStack(alignment: .topLeading) {
                if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Text(placeholder)
                        .font(.body)
                        .foregroundStyle(AtlasStyle.mutedText)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 13)
                }
                TextEditor(text: $text)
                    .font(.body)
                    .foregroundStyle(AtlasStyle.primaryText)
                    .frame(minHeight: 92)
                    .padding(8)
                    .background(Color.clear)
            }
            .background(AtlasStyle.cardRaised, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(AtlasStyle.border, lineWidth: 1))
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject private var store: AtlasStore
    @EnvironmentObject private var accessSession: AtlasAccessSession
    @EnvironmentObject private var supabaseSession: NativeSupabaseSession
    @State private var showingAccessLogin = false
    @State private var showingSupabaseLogin = false
    @State private var serviceTokenId = ""
    @State private var serviceTokenSecret = ""
    @State private var manualCookie = ""

    var body: some View {
        NavigationView {
            List {
                Section("Connection") {
                    StatusLine(title: "Backend", value: "atlas.ransomed.app")
                    StatusLine(title: "Mode", value: "Native execution")
                    StatusLine(title: "Auth", value: supabaseSession.isAuthenticated ? "Native Supabase session" : store.state.authLabel)
                    StatusLine(title: "Method", value: supabaseSession.isAuthenticated ? "Email/password" : (supabaseSession.refreshTokenAvailable ? "Face ID available" : "None"))
                    if let email = supabaseSession.email {
                        StatusLine(title: "Account", value: email)
                    }
                    StatusLine(title: "Last access check", value: store.lastAccessDiagnostic)
                    StatusLine(title: "Local cache", value: store.syncStatus.summary)
                    StatusLine(title: "Pending writes", value: "\(store.syncStatus.pendingWrites)")
                    if let lastError = store.syncStatus.lastError {
                        StatusLine(title: "Last sync error", value: lastError)
                    }
                    if let lastUpdated = store.lastUpdated {
                        StatusLine(title: "Last refresh", value: lastUpdated.formatted(date: .omitted, time: .shortened))
                    }
                }

                Section("Actions") {
                    Button {
                        Task { await store.load() }
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }

                    Button {
                        showingSupabaseLogin = true
                    } label: {
                        Label(supabaseSession.isAuthenticated ? "Manage app login" : "Sign in with email", systemImage: "person.badge.key")
                    }

                    if supabaseSession.isAuthenticated || supabaseSession.refreshTokenAvailable {
                        Button(role: .destructive) {
                            supabaseSession.signOut()
                            Task { await store.load() }
                        } label: {
                            Label("Sign out of app", systemImage: "key.slash")
                        }
                    }
                }

                Section("Native login") {
                    Text("Atlas now signs in directly with Supabase email/password. The refresh session is stored in Keychain and can be unlocked with Face ID.")
                        .font(.caption)
                        .foregroundStyle(AtlasStyle.secondaryText)

                    if supabaseSession.refreshTokenAvailable {
                        Button {
                            Task {
                                await supabaseSession.unlockWithFaceID()
                                await store.load()
                            }
                        } label: {
                            Label("Unlock with Face ID", systemImage: "faceid")
                        }
                    }
                }

                Section("Security") {
                    Label("Uses the public Supabase anon key plus your signed-in session.", systemImage: "lock.shield")
                    Label("No service-role or Cloudflare service-token secret is embedded.", systemImage: "key.slash")
                }
            }
            .navigationTitle("Settings")
            .background(AtlasStyle.background)
            .onAppear {
                serviceTokenId = accessSession.serviceTokenId ?? ""
            }
            .sheet(isPresented: $showingAccessLogin) {
                AccessLoginSheet()
                    .environmentObject(store)
                    .environmentObject(accessSession)
                    .environmentObject(supabaseSession)
            }
            .sheet(isPresented: $showingSupabaseLogin) {
                AccessLoginSheet()
                    .environmentObject(store)
                    .environmentObject(accessSession)
                    .environmentObject(supabaseSession)
            }
        }
    }
}

enum AtlasProtectedSurface {
    case today
    case actions
    case review
    case calendar

    var previewTitle: String {
        switch self {
        case .today:
            return "Today sections"
        case .actions:
            return "Action execution"
        case .review:
            return "Review queue"
        case .calendar:
            return "Dated work"
        }
    }

    var rows: [AtlasProtectedPreviewItem] {
        switch self {
        case .today:
            return [
                AtlasProtectedPreviewItem(title: "On Fire", detail: "P0 and overdue actions appear here after access passes.", symbol: "flame.fill", tone: AtlasStyle.danger),
                AtlasProtectedPreviewItem(title: "Due Today", detail: "Date-bound work stays grouped by urgency.", symbol: "clock.fill", tone: AtlasStyle.accent),
                AtlasProtectedPreviewItem(title: "Review", detail: "User-gated approvals stay visible, with status execution available after login.", symbol: "person.crop.circle.badge.checkmark", tone: AtlasStyle.purple)
            ]
        case .actions:
            return [
                AtlasProtectedPreviewItem(title: "Start work", detail: "Open an action and move it to in-progress with a narrow revision-checked write.", symbol: "play.fill", tone: AtlasStyle.blue),
                AtlasProtectedPreviewItem(title: "Mark done", detail: "Finish only the action status; activity evidence is inserted separately.", symbol: "checkmark.circle.fill", tone: AtlasStyle.success),
                AtlasProtectedPreviewItem(title: "Route blockers", detail: "Blocked and pending-review lanes stay visible once the Atlas feed loads.", symbol: "exclamationmark.triangle.fill", tone: AtlasStyle.danger)
            ]
        case .review:
            return [
                AtlasProtectedPreviewItem(title: "User-gated", detail: "Approvals and user-only decisions stay separate from the main backlog.", symbol: "person.crop.circle.badge.checkmark", tone: AtlasStyle.purple),
                AtlasProtectedPreviewItem(title: "Reload before acting", detail: "Refresh keeps revision state current before any status change.", symbol: "arrow.clockwise", tone: AtlasStyle.accent),
                AtlasProtectedPreviewItem(title: "No silent overwrite", detail: "Stale rows are rejected instead of overwriting web or agent changes.", symbol: "lock.shield.fill", tone: AtlasStyle.success)
            ]
        case .calendar:
            return [
                AtlasProtectedPreviewItem(title: "Due dates", detail: "Scheduled actions sort by due date when the protected feed is available.", symbol: "calendar.badge.clock", tone: AtlasStyle.accent),
                AtlasProtectedPreviewItem(title: "Review dates", detail: "Review windows stay in the same calendar lane as execution due dates.", symbol: "calendar.badge.exclamationmark", tone: AtlasStyle.purple),
                AtlasProtectedPreviewItem(title: "Active only", detail: "Completed actions stay out of the live planning lane.", symbol: "line.3.horizontal.decrease.circle", tone: AtlasStyle.blue)
            ]
        }
    }
}

struct AtlasProtectedPreviewItem {
    let title: String
    let detail: String
    let symbol: String
    let tone: Color
}

struct AtlasScreen<Content: View>: View {
    let state: AtlasLoadState
    var protectedSurface: AtlasProtectedSurface = .today
    let retry: () async -> Void
    @ViewBuilder var content: Content

    var body: some View {
        ZStack {
            AtlasStyle.background.ignoresSafeArea()
            switch state {
            case .idle, .loading:
                ProgressView("Loading Atlas")
            case .loaded:
                content
            case .protected:
                ProtectedStateView(surface: protectedSurface, retry: retry)
            case .failed(let message):
                ErrorStateView(message: message, retry: retry)
            }
        }
    }
}

struct ProtectedStateView: View {
    let surface: AtlasProtectedSurface
    let retry: () async -> Void
    @EnvironmentObject private var store: AtlasStore
    @EnvironmentObject private var accessSession: AtlasAccessSession
    @EnvironmentObject private var supabaseSession: NativeSupabaseSession
    @State private var showingAccessLogin = false
    @State private var showingSettings = false

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14) {
                TodayNativeHeader(totalFocus: 0)

                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: "lock.shield.fill")
                        .font(.title3.weight(.bold))
                        .foregroundStyle(AtlasStyle.warning)
                        .frame(width: 38, height: 38)
                        .background(AtlasStyle.warning.opacity(0.14), in: RoundedRectangle(cornerRadius: 10, style: .continuous))

                    VStack(alignment: .leading, spacing: 7) {
                        Text("Cloudflare Access required")
                            .font(.headline.weight(.semibold))
                            .foregroundStyle(AtlasStyle.primaryText)
                        Text(supabaseSession.refreshTokenAvailable ? "Use Face ID to unlock the saved app session, then Atlas can read directly from Supabase." : "Sign in with your app email and password. This avoids Google login inside the embedded app browser.")
                            .font(.subheadline)
                            .foregroundStyle(AtlasStyle.secondaryText)
                            .fixedSize(horizontal: false, vertical: true)
                        Text(store.lastAccessDiagnostic)
                            .font(.caption)
                            .foregroundStyle(AtlasStyle.mutedText)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(14)
                .atlasCard(cornerRadius: 12)

                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                    ProtectedStatusTile(label: "Login", value: supabaseSession.isAuthenticated ? "Signed in" : (supabaseSession.refreshTokenAvailable ? "Face ID" : "Required"), symbol: "person.badge.key", tone: AtlasStyle.warning)
                    ProtectedStatusTile(label: "Mode", value: "Execute", symbol: "play.circle", tone: AtlasStyle.accent)
                    ProtectedStatusTile(label: "Backend", value: "Atlas", symbol: "server.rack", tone: AtlasStyle.blue)
                    ProtectedStatusTile(label: "Writes", value: "Status", symbol: "checkmark.circle", tone: AtlasStyle.success)
                }

                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                    Button {
                        showingAccessLogin = true
                    } label: {
                        Label("Sign in", systemImage: "person.badge.key")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)

                    Button {
                        Task { await retry() }
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)

                    Button {
                        showingSettings = true
                    } label: {
                        Label("Settings", systemImage: "gearshape")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                }

                VStack(alignment: .leading, spacing: 10) {
                    Text(surface.previewTitle)
                        .font(.headline.weight(.semibold))
                        .foregroundStyle(AtlasStyle.primaryText)
                    ForEach(surface.rows, id: \.title) { item in
                        ProtectedPreviewRow(title: item.title, detail: item.detail, symbol: item.symbol, tone: item.tone)
                    }
                }
                .padding(14)
                .atlasCard(cornerRadius: 12)
            }
            .padding(16)
            .padding(.bottom, 132)
        }
        .refreshable {
            await retry()
        }
        .sheet(isPresented: $showingAccessLogin) {
            AccessLoginSheet()
                .environmentObject(store)
                .environmentObject(accessSession)
                .environmentObject(supabaseSession)
        }
        .sheet(isPresented: $showingSettings) {
            SettingsView()
                .environmentObject(store)
                .environmentObject(accessSession)
                .environmentObject(supabaseSession)
        }
    }
}

struct ProtectedStatusTile: View {
    let label: String
    let value: String
    let symbol: String
    let tone: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Image(systemName: symbol)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(tone)
            Text(value)
                .font(.headline.weight(.semibold))
                .foregroundStyle(AtlasStyle.primaryText)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Text(label.uppercased())
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(AtlasStyle.mutedText)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(13)
        .atlasCard(cornerRadius: 12)
    }
}

struct ProtectedPreviewRow: View {
    let title: String
    let detail: String
    let symbol: String
    let tone: Color

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: symbol)
                .font(.caption.weight(.bold))
                .foregroundStyle(tone)
                .frame(width: 28, height: 28)
                .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(AtlasStyle.primaryText)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(AtlasStyle.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
    }
}

struct AccessLoginSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: AtlasStore
    @EnvironmentObject private var supabaseSession: NativeSupabaseSession
    @State private var email = ""
    @State private var password = ""

    var body: some View {
        NavigationView {
            VStack(alignment: .leading, spacing: 16) {
                Label("App login", systemImage: "person.badge.key")
                    .font(.headline)
                    .foregroundStyle(AtlasStyle.primaryText)

                Text("Sign in with Supabase email and password. The saved session stays in Keychain and can be unlocked with Face ID.")
                    .font(.subheadline)
                    .foregroundStyle(AtlasStyle.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)

                TextField("Email", text: $email)
                    .keyboardType(.emailAddress)
                    .textContentType(.username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textFieldStyle(.roundedBorder)

                SecureField("Password", text: $password)
                    .textContentType(.password)
                    .textFieldStyle(.roundedBorder)

                Button {
                    Task {
                        await supabaseSession.signIn(email: email, password: password)
                        await store.load()
                    }
                } label: {
                    Label("Sign in", systemImage: "arrow.right.circle.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(supabaseSession.isLoading || email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || password.isEmpty)

                if supabaseSession.refreshTokenAvailable {
                    Button {
                        Task {
                            await supabaseSession.unlockWithFaceID()
                            await store.load()
                        }
                    } label: {
                        Label("Unlock with Face ID", systemImage: "faceid")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .disabled(supabaseSession.isLoading)
                }

                Text(supabaseSession.statusMessage)
                    .font(.footnote)
                    .foregroundStyle(AtlasStyle.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)

                if supabaseSession.isLoading {
                    ProgressView()
                        .tint(AtlasStyle.accent)
                }
            }
            .padding(18)
            .background(AtlasStyle.background)
            .navigationTitle("Atlas Login")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") {
                        dismiss()
                        Task { await store.load() }
                    }
                }
            }
            .onAppear {
                email = supabaseSession.email ?? ""
            }
        }
    }
}

struct AtlasAccessWebView: UIViewRepresentable {
    @Binding var status: String
    let onSession: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.load(URLRequest(url: URL(string: "https://atlas.ransomed.app")!))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.parent = self
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var parent: AtlasAccessWebView
        private var didComplete = false

        init(_ parent: AtlasAccessWebView) {
            self.parent = parent
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            updateStatus(for: webView.url)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            updateStatus(for: webView.url)
            captureAccessCookie(from: webView)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            parent.status = error.localizedDescription
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            parent.status = error.localizedDescription
        }

        private func updateStatus(for url: URL?) {
            guard let host = url?.host else {
                parent.status = "Waiting for Cloudflare Access."
                return
            }

            if host.contains("cloudflareaccess.com") {
                parent.status = "Complete the Cloudflare Access sign-in."
            } else if host.contains("atlas.ransomed.app") {
                parent.status = "Checking Atlas session."
            } else {
                parent.status = "Loading \(host)."
            }
        }

        private func captureAccessCookie(from webView: WKWebView) {
            guard !didComplete else { return }
            webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { cookies in
                guard let cookie = cookies.first(where: { cookie in
                    cookie.name == "CF_Authorization" && cookie.domain.contains("ransomed.app")
                }) else {
                    return
                }

                DispatchQueue.main.async {
                    self.didComplete = true
                    self.parent.status = "Cloudflare Access session saved."
                    self.parent.onSession("CF_Authorization=\(cookie.value)")
                }
            }
        }
    }
}

struct ErrorStateView: View {
    let message: String
    let retry: () async -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 36, weight: .semibold))
                .foregroundStyle(.orange)
            Text("Atlas could not load")
                .font(.title.weight(.bold))
                .foregroundStyle(AtlasStyle.primaryText)
            Text(message)
                .foregroundStyle(AtlasStyle.secondaryText)
            Button {
                Task { await retry() }
            } label: {
                Label("Try again", systemImage: "arrow.clockwise")
            }
            .buttonStyle(.borderedProminent)
        }
        .padding(24)
        .frame(maxWidth: .infinity, alignment: .leading)
        .atlasCard()
        .padding()
    }
}

struct AtlasSearchHeader: View {
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "line.3.horizontal")
                .foregroundStyle(AtlasStyle.secondaryText)
            Text("Dashboard")
                .font(.headline.weight(.semibold))
                .foregroundStyle(AtlasStyle.primaryText)
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(AtlasStyle.secondaryText)
                Text("Search actions...")
                    .font(.subheadline)
                    .foregroundStyle(AtlasStyle.secondaryText)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .frame(height: 42)
            .background(AtlasStyle.cardRaised, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(AtlasStyle.border, lineWidth: 1)
            )
        }
    }
}

struct DashboardMetricGrid: View {
    let actions: [AtlasAction]

    var body: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
            DashboardMetricTile(label: "Active", value: "\(actions.filter { !$0.isDone }.count)", symbol: "waveform.path.ecg", tone: AtlasStyle.accent)
            DashboardMetricTile(label: "Overdue", value: "\(actions.filter { $0.isOverdue }.count)", symbol: "exclamationmark.triangle", tone: AtlasStyle.danger)
            DashboardMetricTile(label: "Completed (7d)", value: "\(actions.filter { $0.isDone }.count)", symbol: "checkmark.circle", tone: AtlasStyle.warning)
            DashboardMetricTile(label: "Blocked", value: "\(actions.filter { $0.isBlocked }.count)", symbol: "nosign", tone: AtlasStyle.warning)
            DashboardMetricTile(label: "Pending review", value: "\(actions.filter { $0.needsReview }.count)", symbol: "doc.text", tone: AtlasStyle.purple)
        }
    }
}

struct DashboardMetricTile: View {
    let label: String
    let value: String
    let symbol: String
    let tone: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(label.uppercased())
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(AtlasStyle.secondaryText)
                Spacer()
                Image(systemName: symbol)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(tone)
            }
            Text(value)
                .font(.title2.weight(.bold))
                .foregroundStyle(AtlasStyle.primaryText)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, minHeight: 86, alignment: .topLeading)
        .padding(18)
        .atlasCard(cornerRadius: 14)
    }
}

struct ProtocolChipCloud: View {
    let actions: [AtlasAction]

    var body: some View {
        let reviewCount = actions.filter { $0.needsReview }.count
        let blockedCount = actions.filter { $0.isBlocked }.count
        let staleCount = actions.filter { $0.isOverdue }.count

        LazyVGrid(columns: [GridItem(.adaptive(minimum: 142), spacing: 8)], alignment: .leading, spacing: 8) {
            ProtocolChip(label: "Codex pull queue", count: actions.filter { $0.workModeLabel.localizedCaseInsensitiveContains("auto") }.count)
            ProtocolChip(label: "Needs review", count: reviewCount)
            ProtocolChip(label: "User only", count: actions.filter { $0.workModeLabel.localizedCaseInsensitiveContains("user") }.count)
            ProtocolChip(label: "Unclassified cleanup", count: blockedCount)
            ProtocolChip(label: "Stale / stewardship", count: staleCount)
        }
    }
}

struct ProtocolChip: View {
    let label: String
    let count: Int

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "checklist")
                .font(.caption2.weight(.bold))
            Text(label.uppercased())
                .font(.system(size: 11, weight: .bold))
                .lineLimit(1)
            if count > 0 {
                Text("\(count)")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(AtlasStyle.background)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 2)
                    .background(AtlasStyle.accent, in: Capsule())
            }
        }
        .foregroundStyle(AtlasStyle.primaryText)
        .padding(.horizontal, 10)
        .frame(height: 34)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AtlasStyle.cardRaised, in: Capsule())
        .overlay(Capsule().stroke(AtlasStyle.border, lineWidth: 1))
    }
}

struct BusinessChipRow: View {
    let actions: [AtlasAction]

    var body: some View {
        let businesses = Array(Set(actions.compactMap { $0.business?.nilIfBlank }))
            .sorted()
            .prefix(4)

        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                BusinessChip(label: "All", selected: true)
                ForEach(Array(businesses), id: \.self) { business in
                    BusinessChip(label: business, selected: false)
                }
            }
        }
    }
}

struct BusinessChip: View {
    let label: String
    let selected: Bool

    var body: some View {
        Text(label.uppercased())
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(selected ? AtlasStyle.background : AtlasStyle.primaryText)
            .padding(.horizontal, 14)
            .frame(height: 32)
            .background(selected ? AtlasStyle.accent : AtlasStyle.cardRaised, in: Capsule())
            .overlay(Capsule().stroke(selected ? Color.clear : AtlasStyle.border, lineWidth: 1))
    }
}

struct FilterControlGrid: View {
    var body: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
            FilterControl(label: "Status")
            FilterControl(label: "Work mode")
            FilterControl(label: "Priority")
        }
    }
}

struct FilterControl: View {
    let label: String

    var body: some View {
        HStack(spacing: 6) {
            Text(label)
                .font(.caption.weight(.medium))
                .foregroundStyle(AtlasStyle.primaryText)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
            Spacer(minLength: 0)
            Image(systemName: "chevron.down")
                .font(.caption2.weight(.bold))
                .foregroundStyle(AtlasStyle.secondaryText)
        }
        .padding(.horizontal, 10)
        .frame(height: 34)
        .background(AtlasStyle.cardRaised, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .stroke(AtlasStyle.border, lineWidth: 1)
        )
    }
}

struct DashboardActionCard: View {
    let action: AtlasAction

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 8) {
                PriorityPill(action: action)
                StatusPill(text: action.statusLabel, color: action.statusColor)
                Spacer()
                if let owner = action.owners.first?.nilIfBlank {
                    Text(String(owner.prefix(1)).uppercased())
                        .font(.caption.weight(.bold))
                        .foregroundStyle(AtlasStyle.background)
                        .frame(width: 22, height: 22)
                        .background(AtlasStyle.purple, in: Circle())
                }
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(AtlasStyle.secondaryText)
            }

            Text(action.title)
                .font(.headline.weight(.semibold))
                .foregroundStyle(AtlasStyle.primaryText)
                .lineLimit(2)

            HStack(spacing: 8) {
                if let business = action.business?.nilIfBlank {
                    StatusPill(text: business, color: AtlasStyle.blue)
                }
                StatusPill(text: action.workModeLabel, color: AtlasStyle.success)
                Spacer()
                Text(action.dueDate ?? "No date")
                    .font(.caption)
                    .foregroundStyle(AtlasStyle.secondaryText)
            }
        }
        .padding(16)
        .atlasCard(cornerRadius: 14)
    }
}

struct KanbanLane: View {
    let title: String
    let actions: [AtlasAction]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(title)
                    .font(.headline.weight(.semibold))
                    .foregroundStyle(AtlasStyle.primaryText)
                Spacer()
                Text("\(actions.count)")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(AtlasStyle.background)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(AtlasStyle.accent, in: Capsule())
            }

            if actions.isEmpty {
                Text("No actions in this lane.")
                    .font(.subheadline)
                    .foregroundStyle(AtlasStyle.secondaryText)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 8)
            } else {
                ForEach(actions.prefix(5)) { action in
                    NavigationLink(destination: ActionDetailView(action: action)) {
                        DashboardActionCard(action: action)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(14)
        .background(AtlasStyle.panel, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(AtlasStyle.border, lineWidth: 1)
        )
    }
}

struct DateScopeHeader: View {
    let actions: [AtlasAction]

    var body: some View {
        HStack(spacing: 10) {
            MetricCard(title: "Due", value: "\(actions.filter { $0.dueDate?.nilIfBlank != nil }.count)")
            MetricCard(title: "Review", value: "\(actions.filter { $0.reviewDate?.nilIfBlank != nil }.count)")
            MetricCard(title: "Overdue", value: "\(actions.filter(\.isOverdue).count)")
        }
    }
}

struct CalendarActionRow: View {
    let action: AtlasAction

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(spacing: 2) {
                Text(action.dueDate ?? action.reviewDate ?? "No date")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(AtlasStyle.accent)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.7)
            }
            .frame(width: 74)
            .frame(minHeight: 52)
            .background(AtlasStyle.cardRaised, in: RoundedRectangle(cornerRadius: 10, style: .continuous))

            VStack(alignment: .leading, spacing: 6) {
                Text(action.title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(AtlasStyle.primaryText)
                    .lineLimit(2)
                HStack(spacing: 6) {
                    StatusPill(text: action.statusLabel, color: action.statusColor)
                    if let business = action.business?.nilIfBlank {
                        StatusPill(text: business, color: AtlasStyle.blue)
                    }
                }
            }

            Spacer(minLength: 0)
        }
        .padding(12)
        .atlasCard(cornerRadius: 12)
    }
}

struct DraftField: View {
    let label: String

    var body: some View {
        HStack {
            Text(label)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(AtlasStyle.secondaryText)
            Spacer()
            Text("Locked")
                .font(.caption.weight(.semibold))
                .foregroundStyle(AtlasStyle.mutedText)
        }
        .padding(.horizontal, 12)
        .frame(height: 48)
        .background(AtlasStyle.cardRaised, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(AtlasStyle.border, lineWidth: 1)
        )
    }
}

struct ActionRow: View {
    let action: AtlasAction

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(action.title)
                    .font(.headline)
                    .foregroundStyle(AtlasStyle.primaryText)
                    .lineLimit(2)
                Spacer()
                PriorityPill(action: action)
            }

            Text(action.primaryDetail)
                .font(.subheadline)
                .foregroundStyle(AtlasStyle.secondaryText)
                .lineLimit(2)

            MetadataLine(action: action)
        }
        .padding(.vertical, 6)
    }
}

struct FocusCard: View {
    let action: AtlasAction

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                PriorityPill(action: action)
                StatusPill(text: action.statusLabel)
                Spacer()
                if action.isBlocked {
                    Image(systemName: "pause.circle.fill")
                .foregroundStyle(.orange)
                }
            }

            Text(action.title)
                .font(.title3.weight(.semibold))
                .foregroundStyle(AtlasStyle.primaryText)
                .lineLimit(3)

            Text(action.primaryDetail)
                .foregroundStyle(AtlasStyle.secondaryText)
                .lineLimit(3)

            MetadataLine(action: action)
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .atlasCard()
    }
}

struct ReviewRow: View {
    let action: AtlasAction

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(action.title)
                .font(.headline)
                .foregroundStyle(AtlasStyle.primaryText)
                .lineLimit(2)

            HStack {
                StatusPill(text: action.workModeLabel)
                if let reviewDate = action.reviewDate {
                    Label(reviewDate, systemImage: "calendar")
                        .font(.caption)
                        .foregroundStyle(AtlasStyle.secondaryText)
                }
            }

            Text(action.primaryDetail)
                .font(.subheadline)
                .foregroundStyle(AtlasStyle.secondaryText)
                .lineLimit(2)
        }
        .padding(.vertical, 6)
    }
}

struct ActionDetailView: View {
    @EnvironmentObject private var store: AtlasStore
    let action: AtlasAction
    @State private var showingEdit = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        PriorityPill(action: action)
                        StatusPill(text: action.statusLabel)
                        if action.needsReview {
                            StatusPill(text: "Review", color: AtlasStyle.purple)
                        }
                        if action.isBlocked {
                            StatusPill(text: "Blocked", color: AtlasStyle.danger)
                        }
                    }

                    Text(action.title)
                        .font(.largeTitle.weight(.bold))
                        .foregroundStyle(AtlasStyle.primaryText)
                        .fixedSize(horizontal: false, vertical: true)

                    Text(action.primaryDetail)
                        .font(.body)
                        .foregroundStyle(AtlasStyle.secondaryText)
                }
                .padding()
                .atlasCard()

                ExecutionControlPanel(action: action)

                Button {
                    showingEdit = true
                } label: {
                    Label("Edit action", systemImage: "slider.horizontal.3")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(AtlasActionButtonStyle(tone: AtlasStyle.accent, filled: false))
                .disabled(!store.writesEnabled)

                DetailSection(title: "Execution", rows: [
                    ("Next action", action.nextAction ?? "Not captured"),
                    ("Done means", action.completionProof),
                    ("Work mode", action.workModeLabel),
                    ("Approval", action.approvalState ?? "Not set")
                ])

                if !action.blockedBy.isEmpty || action.isBlocked {
                    DetailSection(title: "Blockers", rows: [
                        ("Blocked by", action.blockedBy.isEmpty ? "Marked blocked without blocker detail" : action.blockedBy.joined(separator: ", "))
                    ])
                }

                DetailSection(title: "Timing", rows: [
                    ("Due", action.dueDate ?? "No due date"),
                    ("Review", action.reviewDate ?? "No review date"),
                    ("Business", action.business ?? "Unassigned")
                ])

                DetailSection(title: "Routing", rows: [
                    ("Owners", action.owners.isEmpty ? "Unassigned" : action.owners.joined(separator: ", ")),
                    ("Tags", action.tags.isEmpty ? "None" : action.tags.joined(separator: ", ")),
                    ("Source", action.sourceLabel ?? "Not captured"),
                    ("Updated by", action.updatedSource ?? "Unknown"),
                    ("Revision", "r\(action.revision)")
                ])
            }
            .padding()
            .padding(.bottom, 132)
        }
        .background(AtlasStyle.background.ignoresSafeArea())
        .navigationTitle("Action")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showingEdit) {
            AtlasActionEditSheet(action: action)
                .environmentObject(store)
        }
    }
}

struct AtlasActionEditSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: AtlasStore
    let action: AtlasAction
    @State private var draft: AtlasActionDraft

    init(action: AtlasAction) {
        self.action = action
        _draft = State(initialValue: AtlasActionDraft.from(action: action))
    }

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("Edit action")
                            .font(.title2.weight(.bold))
                            .foregroundStyle(AtlasStyle.primaryText)
                        Text("Save only the fields on this form. Done still uses the dedicated Done button so completion evidence is attached.")
                            .font(.subheadline)
                            .foregroundStyle(AtlasStyle.secondaryText)
                    }
                    .padding()
                    .atlasCard(cornerRadius: 12)

                    AtlasActionDraftForm(draft: $draft, mode: .edit)

                    if let message = store.mutationMessage {
                        AtlasCommandFeedback(message: message)
                    }
                }
                .padding(16)
                .padding(.bottom, 24)
            }
            .background(AtlasStyle.background.ignoresSafeArea())
            .navigationTitle("Edit")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            await store.updateAction(action, draft: draft)
                            if store.mutationMessage?.lowercased().contains("saved") == true {
                                dismiss()
                            }
                        }
                    }
                    .disabled(!store.writesEnabled || !draft.isValid)
                }
            }
        }
    }
}

struct ExecutionControlPanel: View {
    @EnvironmentObject private var store: AtlasStore
    let action: AtlasAction
    @State private var showingCapture = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Execute")
                        .font(.headline.weight(.semibold))
                        .foregroundStyle(AtlasStyle.primaryText)
                    Text("Narrow status changes use the row revision so web or agent edits cannot be silently overwritten.")
                        .font(.caption)
                        .foregroundStyle(AtlasStyle.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
                Text("r\(action.revision)")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(AtlasStyle.mutedText)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(AtlasStyle.cardRaised, in: Capsule())
            }

            if let message = store.mutationMessage {
                AtlasCommandFeedback(message: message)
            }

            AtlasEvidenceExpectationRow(action: action)

            VStack(spacing: 10) {
                HStack(spacing: 10) {
                    Button {
                        Task { await store.transition(action, to: "in_progress") }
                    } label: {
                        Label("Start", systemImage: "play.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(AtlasActionButtonStyle(tone: AtlasStyle.blue))
                    .disabled(!store.writesEnabled || action.isDone || action.isBlocked)

                    Button {
                        Task { await store.transition(action, to: "done") }
                    } label: {
                        Label("Done", systemImage: "checkmark")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(AtlasActionButtonStyle(tone: AtlasStyle.success))
                    .disabled(!store.writesEnabled || action.isDone)
                }

                HStack(spacing: 10) {
                    Button {
                        Task { await store.transition(action, to: "blocked") }
                    } label: {
                        Label("Block", systemImage: "exclamationmark.triangle.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(AtlasActionButtonStyle(tone: AtlasStyle.warning, filled: false))
                    .disabled(!store.writesEnabled || action.isDone || action.isBlocked)

                    Button {
                        showingCapture = true
                    } label: {
                        Label("Capture", systemImage: "square.and.pencil")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(AtlasActionButtonStyle(tone: AtlasStyle.accent, filled: false))
                    .disabled(!store.writesEnabled || action.isDone)
                }
            }

            Button {
                Task { await store.load() }
            } label: {
                Label("Refresh action list", systemImage: "arrow.clockwise")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(AtlasActionButtonStyle(tone: AtlasStyle.accent, filled: false))
        }
        .padding()
        .atlasCard()
        .sheet(isPresented: $showingCapture) {
            AtlasCaptureSheet(action: action)
                .environmentObject(store)
        }
    }
}

struct AtlasActionButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    let tone: Color
    var filled = true

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.bold))
            .foregroundStyle(filled ? AtlasStyle.background : tone)
            .padding(.vertical, 12)
            .opacity(isEnabled ? 1 : 0.55)
            .background(background, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(tone.opacity(filled ? 0 : 0.35), lineWidth: 1)
            )
    }

    private var background: Color {
        if !isEnabled {
            return filled ? AtlasStyle.cardRaised : tone.opacity(0.06)
        }
        return filled ? tone : tone.opacity(0.10)
    }
}

struct SummaryStrip: View {
    let actions: [AtlasAction]

    var body: some View {
        HStack(spacing: 10) {
            MetricCard(title: "Active", value: "\(actions.filter { !$0.isDone }.count)")
            MetricCard(title: "Review", value: "\(actions.filter { $0.needsReview }.count)")
            MetricCard(title: "Blocked", value: "\(actions.filter { $0.isBlocked }.count)")
        }
    }
}

struct MetricCard: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(value)
                .font(.title2.weight(.bold))
                .foregroundStyle(AtlasStyle.primaryText)
            Text(title)
                .font(.caption)
                .foregroundStyle(AtlasStyle.secondaryText)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .atlasCard()
    }
}

struct DetailSection: View {
    let title: String
    let rows: [(String, String)]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.headline)
                .foregroundStyle(AtlasStyle.primaryText)
            ForEach(rows, id: \.0) { row in
                HStack(alignment: .top) {
                    Text(row.0)
                        .foregroundStyle(AtlasStyle.secondaryText)
                    Spacer(minLength: 16)
                    Text(row.1.isEmpty ? "Not set" : row.1)
                        .foregroundStyle(AtlasStyle.primaryText)
                        .multilineTextAlignment(.trailing)
                }
                .font(.subheadline)
            }
        }
        .padding()
        .atlasCard()
    }
}

struct MetadataLine: View {
    let action: AtlasAction

    var body: some View {
        HStack(spacing: 8) {
            if let dueDate = action.dueDate {
                Label(dueDate, systemImage: "calendar")
            }
            if let business = action.business?.nilIfBlank {
                Label(business, systemImage: "building.2")
            }
            if action.isBlocked {
                Label("Blocked", systemImage: "pause.circle")
            }
        }
        .font(.caption)
        .foregroundStyle(AtlasStyle.secondaryText)
        .lineLimit(1)
    }
}

struct PriorityPill: View {
    let action: AtlasAction

    var body: some View {
        StatusPill(text: action.priorityLabel, color: action.priorityColor)
    }
}

struct StatusPill: View {
    let text: String
    var color: Color = AtlasStyle.accent

    var body: some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .foregroundStyle(color)
            .background(color.opacity(0.12))
            .clipShape(Capsule())
    }
}

struct StatusLine: View {
    let title: String
    let value: String

    var body: some View {
        HStack {
            Text(title)
            Spacer()
            Text(value)
                .foregroundStyle(AtlasStyle.secondaryText)
                .multilineTextAlignment(.trailing)
        }
    }
}

struct EmptyNativeState: View {
    let title: String
    let message: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.headline)
                .foregroundStyle(AtlasStyle.primaryText)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(AtlasStyle.secondaryText)
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .atlasCard()
    }
}

extension AtlasAction {
    var priorityColor: Color {
        switch priorityRank {
        case 0: return AtlasStyle.danger
        case 1: return AtlasStyle.warning
        case 2: return AtlasStyle.accent
        case 3: return AtlasStyle.success
        default: return AtlasStyle.secondaryText
        }
    }

    var statusColor: Color {
        let normalized = canonicalStatus
        if normalized.contains("progress") { return AtlasStyle.blue }
        if normalized.contains("waiting") { return AtlasStyle.warning }
        if normalized.contains("done") || normalized.contains("complete") { return AtlasStyle.success }
        if isBlocked { return AtlasStyle.warning }
        return AtlasStyle.secondaryText
    }
}

extension AtlasLoadState {
    var authLabel: String {
        switch self {
        case .protected:
            return "Cloudflare Access required"
        case .loaded:
            return "API session active"
        case .failed:
            return "Error"
        case .idle, .loading:
            return "Checking"
        }
    }
}

enum AtlasStyle {
    static let background = Color(red: 0.055, green: 0.055, blue: 0.055)
    static let panel = Color(red: 0.075, green: 0.075, blue: 0.075)
    static let card = Color(red: 0.098, green: 0.102, blue: 0.102)
    static let cardRaised = Color(red: 0.145, green: 0.149, blue: 0.149)
    static let border = Color.white.opacity(0.12)
    static let primaryText = Color(red: 0.898, green: 0.898, blue: 0.898)
    static let secondaryText = Color(red: 0.64, green: 0.64, blue: 0.64)
    static let mutedText = Color(red: 0.322, green: 0.322, blue: 0.322)
    static let accent = Color(red: 0.957, green: 0.722, blue: 0.376)
    static let warning = Color(red: 0.957, green: 0.612, blue: 0.227)
    static let danger = Color(red: 0.937, green: 0.341, blue: 0.341)
    static let success = Color(red: 0.357, green: 0.776, blue: 0.553)
    static let blue = Color(red: 0.361, green: 0.608, blue: 1.0)
    static let purple = Color(red: 0.651, green: 0.569, blue: 1.0)
}
