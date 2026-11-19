import CoreLocation
import SwiftUI
import BestCardEngine
import CardPickerCore

/// Up to 20 saved stores, shown under the map. With alerts on, arriving at
/// one posts a notification.
struct SavedPlacesSection: View {
    @Environment(AppModel.self) private var model
    @State private var monitored: [String] = []

    var body: some View {
        Section {
            AlertsToggle()
            if model.data.savedPlaces.isEmpty {
                Text("Tap a store above and save it, or use + to save the spot you're standing in.").foregroundStyle(.secondary)
            }
            ForEach(model.data.savedPlaces) { place in
                let answer = model.data.answer(for: place.context)
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Image(systemName: "star.circle.fill").foregroundStyle(.orange)
                        Text(place.name).font(.headline)
                        Spacer()
                        if monitored.contains(place.id.uuidString) {
                            Image(systemName: "bell.fill").font(.caption).foregroundStyle(.green)
                                .accessibilityLabel("Monitored")
                        }
                    }
                    Text(Categories.label(place.category)).font(.caption).foregroundStyle(.secondary)
                    if let answer { Text(answer.notificationText(placeName: place.name)).font(.subheadline) }
                }
                .accessibilityIdentifier("saved-\(place.name)")
                .swipeActions {
                    Button("Delete", role: .destructive) {
                        model.update { $0.savedPlaces.removeAll { $0.id == place.id } }
                    }
                    Button("Test alert") { Task { await PlaceArrival.handle(placeId: place.id.uuidString) } }
                        .tint(.blue)
                }
            }
        } header: {
            Text("Saved places · \(model.data.savedPlaces.count) of \(SavedPlace.maxCount)")
        } footer: {
            Text("Alerts use \"Always\" location and Background App Refresh. iOS monitors at most 20 places.")
        }
        .task(id: "\(model.data.savedPlaces.map(\.id))-\(model.data.savedPlaceAlerts)") {
            try? await Task.sleep(for: .milliseconds(300))
            monitored = await PlaceMonitor.shared.monitoredIdentifiers()
        }
    }
}

struct AlertsToggle: View {
    @Environment(AppModel.self) private var model
    @State private var note: String?

    var body: some View {
        VStack(alignment: .leading) {
            Toggle("Saved place alerts", isOn: Binding(
                get: { model.data.savedPlaceAlerts },
                set: { on in Task { await set(on) } }))
            .accessibilityIdentifier("alertsToggle")
            if let note { Text(note).font(.footnote).foregroundStyle(.orange) }
        }
    }

    private func set(_ on: Bool) async {
        if on {
            // Asks for Always if the Map tab hasn't already.
            let status = await LocationService.shared.requestAlways()
            await Notifications.requestAuthorization()
            note = status == .authorizedAlways ? nil
                : "Location is \"While Using\", so alerts only work while the app is open. Change it to Always in Settings > Card Picker > Location."
        } else {
            note = nil
        }
        model.update { $0.savedPlaceAlerts = on }
    }
}

/// Save the spot you're standing in, with a name and category.
struct AddPlaceHere: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var category = "us_supermarket"
    @State private var location: CLLocation?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                TextField("Name (e.g. Trader Joe's)", text: $name)
                    .accessibilityIdentifier("placeName")
                Picker("Category", selection: $category) {
                    ForEach(Categories.all, id: \.self) { Text(Categories.label($0)).tag($0) }
                }
                Section {
                    if let location {
                        Text(String(format: "%.5f, %.5f", location.coordinate.latitude, location.coordinate.longitude))
                            .font(.footnote.monospaced())
                    } else if let error {
                        Text(error).foregroundStyle(.orange)
                    } else {
                        ProgressView("Getting your location…")
                    }
                }
            }
            .navigationTitle("Save this spot")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        guard let location else { return }
                        let trimmed = name.trimmingCharacters(in: .whitespaces)
                        model.update { d in
                            guard d.savedPlaces.count < SavedPlace.maxCount else { return }
                            d.savedPlaces.append(SavedPlace(name: trimmed, latitude: location.coordinate.latitude,
                                                            longitude: location.coordinate.longitude, category: category, merchant: trimmed))
                        }
                        dismiss()
                    }
                    .disabled(location == nil || name.trimmingCharacters(in: .whitespaces).isEmpty)
                    .accessibilityIdentifier("savePlaceHere")
                }
            }
            .task {
                do { location = try await LocationService.shared.currentLocation() }
                catch { self.error = error.localizedDescription }
            }
            .onChange(of: name) { _, new in
                if let m = model.data.engine.merchant(for: new) { category = m.category }
            }
        }
    }
}
