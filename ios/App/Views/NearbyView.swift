import CoreLocation
import SwiftUI
import BestCardEngine
import CardPickerCore

/// The five nearest places with the best card for each (MapKit lookup).
struct NearbyView: View {
    @Environment(AppModel.self) private var model
    @State private var places: [NearbySearch.Place] = []
    @State private var status: String?
    @State private var loading = false
    @State private var asking: NearbySearch.Place?
    @State private var detail: NearbySearch.Place?

    var body: some View {
        NavigationStack {
            List {
                if model.data.offlineMode {
                    Section {
                        Label("Offline mode is on, so nearby lookups are off. Use the Pick tab or a saved place.", systemImage: "wifi.slash")
                            .accessibilityIdentifier("offlineNotice")
                    }
                } else {
                    if let status {
                        Section { Text(status).foregroundStyle(.secondary) }
                    }
                    Section {
                        ForEach(places) { place in
                            row(place)
                        }
                    } footer: {
                        if !places.isEmpty {
                            Text("Categories come from Apple Maps and are a guess; the bank's merchant code can differ.")
                        }
                    }
                }
            }
            .overlay { if loading && places.isEmpty { ProgressView("Finding places…") } }
            .navigationTitle("Nearby")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { Task { await refresh() } } label: { Image(systemName: "arrow.clockwise") }
                        .disabled(model.data.offlineMode || loading)
                        .accessibilityIdentifier("refreshNearby")
                }
            }
            .task(id: model.data.offlineMode) { await refresh() }
            .refreshable { await refresh() }
            .sheet(item: $asking) { place in
                CategoryPicker(title: "What kind of place is \(place.name)?") { category in
                    model.update { $0.placeCategories[place.key] = category }
                }
            }
            .sheet(item: $detail) { place in
                NearbyDetail(place: place)
            }
        }
    }

    @ViewBuilder
    private func row(_ place: NearbySearch.Place) -> some View {
        let (answer, resolution) = model.data.answer(for: place)
        Button {
            if resolution.source == .unknown { asking = place } else { detail = place }
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(place.name).font(.headline)
                    Spacer()
                    Text("\(Int(place.distance)) m").font(.caption).foregroundStyle(.secondary)
                }
                if let answer {
                    HStack(spacing: 6) {
                        CardBadge(card: answer.card)
                        Text("\(answer.card.name) · \(answer.rateText)").font(.subheadline)
                    }
                }
                Text(resolution.source == .unknown ? "Category unknown: tap to set it" : "Likely \(Self.lowerFirst(Categories.label(resolution.category)))")
                    .font(.caption).foregroundStyle(resolution.source == .unknown ? .orange : .secondary)
            }
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("nearby-\(place.name)")
    }

    /// "Restaurants" -> "restaurants", but "US supermarkets" stays as is.
    static func lowerFirst(_ s: String) -> String {
        guard let first = s.first, s.dropFirst().first?.isUppercase != true else { return s }
        return first.lowercased() + s.dropFirst()
    }

    private func refresh() async {
        guard !model.data.offlineMode else { places = []; return }
        loading = true
        defer { loading = false }
        do {
            let loc = try await LocationService.shared.currentLocation()
            places = try await NearbySearch.search(around: loc, offline: model.data.offlineMode)
            status = places.isEmpty ? "No places found within 200 m." : nil
        } catch {
            status = error.localizedDescription
        }
    }
}

struct NearbyDetail: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let place: NearbySearch.Place
    @State private var changing = false

    var body: some View {
        let (answer, resolution) = model.data.answer(for: place)
        let saved = model.data.savedPlaces.contains { PlaceKey.make(name: $0.name, latitude: $0.latitude, longitude: $0.longitude) == place.key }
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    if let answer { AnswerView(answer: answer, placeName: place.name) }
                    Button(saved ? "Saved" : "Save this place for arrival alerts") {
                        model.update { d in
                            guard d.savedPlaces.count < SavedPlace.maxCount else { return }
                            d.savedPlaces.append(SavedPlace(name: place.name, latitude: place.latitude, longitude: place.longitude,
                                                            category: resolution.category, merchant: place.name))
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(saved || model.data.savedPlaces.count >= SavedPlace.maxCount)
                    .accessibilityIdentifier("savePlace")
                    if model.data.savedPlaces.count >= SavedPlace.maxCount && !saved {
                        Text("iOS allows 20 monitored places. Remove one in Places first.").font(.footnote).foregroundStyle(.secondary)
                    }
                    Button("Wrong category? Change it") { changing = true }
                }
                .padding()
            }
            .navigationTitle(place.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .sheet(isPresented: $changing) {
                CategoryPicker(title: "What kind of place is \(place.name)?") { category in
                    model.update { $0.placeCategories[place.key] = category }
                }
            }
        }
        .onAppear { if let answer { model.record(answer, placeName: place.name) } }
    }
}

struct CategoryPicker: View {
    let title: String
    let onPick: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List(Categories.all, id: \.self) { c in
                Button(Categories.label(c)) { onPick(c); dismiss() }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }
}
