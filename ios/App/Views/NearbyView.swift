import CoreLocation
import MapKit
import SwiftUI
import BestCardEngine
import CardPickerCore

/// The Map tab: Apple Maps around you with the paying places nearby as pins.
/// Tap the pin (or row) for the place you're at to get the card. Drag the map
/// and tap "Search this area" to pick a place somewhere else. Saved places
/// and their arrival alerts live at the bottom of the same list.
struct NearbyView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase
    @State private var places: [NearbySearch.Place] = []
    @State private var status: String?
    @State private var loading = false
    @State private var asking: NearbySearch.Place?
    @State private var detail: NearbySearch.Place?
    @State private var camera: MapCameraPosition = .userLocation(fallback: .automatic)
    @State private var pinned: String?
    @State private var searchedCenter: CLLocationCoordinate2D?
    @State private var visibleCenter: CLLocationCoordinate2D?
    @State private var locationStatus = LocationService.shared.status
    @State private var adding = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if model.data.offlineMode {
                    Label("Offline mode is on, so the map and nearby lookups are off. Use the Pick tab or a saved place.", systemImage: "wifi.slash")
                        .font(.subheadline)
                        .padding()
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color(.secondarySystemBackground))
                        .accessibilityIdentifier("offlineNotice")
                } else {
                    map.frame(height: 330)
                }
                List {
                    if !model.data.offlineMode {
                        if locationStatus != .authorizedAlways {
                            Section { AlwaysLocationBanner(status: locationStatus) }
                        }
                        if let status {
                            Section { Text(status).foregroundStyle(.secondary) }
                        }
                        if !places.isEmpty {
                            Section {
                                ForEach(places) { place in row(place) }
                            } header: {
                                Text("Where are you?")
                            } footer: {
                                Text("Categories come from the store list or Apple Maps; the bank's merchant code can differ.")
                            }
                        }
                    }
                    SavedPlacesSection()
                }
            }
            .navigationTitle("Map")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { Task { await refresh() } } label: { Image(systemName: "arrow.clockwise") }
                        .disabled(model.data.offlineMode || loading)
                        .accessibilityIdentifier("refreshNearby")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { adding = true } label: { Label("Save this spot", systemImage: "plus") }
                        .disabled(model.data.savedPlaces.count >= SavedPlace.maxCount)
                        .accessibilityIdentifier("addPlaceHere")
                }
            }
            .task(id: model.data.offlineMode) {
                guard !model.data.offlineMode else { places = []; return }
                await LocationService.shared.requestWhenInUse()
                locationStatus = LocationService.shared.status
                // Ask once for Always on top (the user wanted it for this tab
                // as well as alerts), in parallel with the first lookup.
                async let upgraded: Void = askForAlwaysOnce()
                await refresh()
                await upgraded
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { locationStatus = LocationService.shared.status }
            }
            .onChange(of: pinned) { _, key in
                if let key, let place = places.first(where: { $0.key == key }) { open(place) }
            }
            .sheet(item: $asking, onDismiss: { pinned = nil }) { place in
                CategoryPicker(title: "What kind of place is \(place.name)?") { category in
                    model.update { $0.placeCategories[place.key] = category }
                }
            }
            .sheet(item: $detail, onDismiss: { pinned = nil }) { place in
                NearbyDetail(place: place)
            }
            .sheet(isPresented: $adding) { AddPlaceHere() }
        }
    }

    private var map: some View {
        Map(position: $camera, selection: $pinned) {
            UserAnnotation()
            ForEach(places) { place in
                let category = model.data.resolve(place).category
                Marker(place.name, systemImage: Self.symbol(category),
                       coordinate: CLLocationCoordinate2D(latitude: place.latitude, longitude: place.longitude))
                    .tint(.blue)
                    .tag(place.key)
            }
            ForEach(model.data.savedPlaces) { saved in
                Annotation(saved.name, coordinate: CLLocationCoordinate2D(latitude: saved.latitude, longitude: saved.longitude)) {
                    Image(systemName: "star.circle.fill")
                        .font(.title3)
                        .foregroundStyle(.white, .orange)
                }
            }
        }
        .mapControls {
            MapUserLocationButton()
            MapCompass()
        }
        .onMapCameraChange(frequency: .onEnd) { visibleCenter = $0.region.center }
        .overlay(alignment: .top) {
            if movedAway {
                Button {
                    guard let c = visibleCenter else { return }
                    Task { await refresh(at: CLLocation(latitude: c.latitude, longitude: c.longitude)) }
                } label: {
                    Label("Search this area", systemImage: "magnifyingglass")
                }
                .buttonStyle(.borderedProminent)
                .padding(.top, 10)
                .accessibilityIdentifier("searchThisArea")
            }
        }
        .overlay { if loading && places.isEmpty { ProgressView() } }
        .accessibilityIdentifier("nearbyMap")
    }

    /// The map was dragged far enough from the last search to offer a new one.
    private var movedAway: Bool {
        guard let v = visibleCenter, !loading else { return false }
        guard let s = searchedCenter else { return true }
        return Geo.distance(v.latitude, v.longitude, s.latitude, s.longitude) > 120
    }

    @ViewBuilder
    private func row(_ place: NearbySearch.Place) -> some View {
        let (answer, resolution) = model.data.answer(for: place)
        Button { open(place) } label: {
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
                Text(resolution.source == .unknown ? "Category unknown: tap to set it" : "Likely \(Categories.label(resolution.category).lowercasedFirst)")
                    .font(.caption).foregroundStyle(resolution.source == .unknown ? .orange : .secondary)
            }
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("nearby-\(place.name)")
    }

    private func open(_ place: NearbySearch.Place) {
        if model.data.resolve(place).source == .unknown { asking = place } else { detail = place }
    }

    /// Around you (nil), or around a spot you dragged the map to.
    private func refresh(at center: CLLocation? = nil) async {
        guard !model.data.offlineMode else { places = []; return }
        loading = true
        defer { loading = false }
        do {
            let loc: CLLocation
            if let center {
                loc = center
            } else {
                loc = try await LocationService.shared.currentLocation()
                camera = .region(MKCoordinateRegion(center: loc.coordinate, latitudinalMeters: 450, longitudinalMeters: 450))
            }
            let radius = center == nil ? NearbySearch.listRadius : NearbySearch.areaRadius
            places = try await NearbySearch.search(around: loc, radius: radius, limit: NearbySearch.mapLimit, offline: model.data.offlineMode)
            searchedCenter = loc.coordinate
            visibleCenter = loc.coordinate
            status = places.isEmpty ? "No stores found here. Drag the map and tap Search this area." : nil
        } catch {
            status = error.localizedDescription
        }
        locationStatus = LocationService.shared.status
    }

    private func askForAlwaysOnce() async {
        let key = "askedAlwaysFromMap"
        guard LocationService.shared.status == .authorizedWhenInUse,
              !UserDefaults.standard.bool(forKey: key) else { return }
        UserDefaults.standard.set(true, forKey: key)
        await LocationService.shared.requestAlways()
        locationStatus = LocationService.shared.status
    }

    static func symbol(_ category: String) -> String {
        GridTile.all.first { $0.category == category }?.symbol ?? "mappin"
    }
}

/// Shown until location is "Always": iOS only offers the switch in Settings
/// after the first prompt.
struct AlwaysLocationBanner: View {
    let status: CLAuthorizationStatus
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(status == .denied || status == .restricted
                 ? "Location is off for Card Picker."
                 : "Location is set to While Using.")
                .font(.subheadline.weight(.semibold))
            Text("Set it to Always so the map finds you right away and saved place alerts work with the app closed.")
                .font(.footnote).foregroundStyle(.secondary)
            Button("Open Settings > Location") {
                if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
            }
            .font(.footnote.weight(.semibold))
            .accessibilityIdentifier("openLocationSettings")
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

extension String {
    /// For labels mid-sentence: "Restaurants" -> "restaurants", but an
    /// acronym such as "US supermarkets" stays as is.
    var lowercasedFirst: String {
        guard let first, dropFirst().first?.isUppercase != true else { return self }
        return first.lowercased() + dropFirst()
    }
}
