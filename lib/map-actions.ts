export type MapAction =
  | { type: "fly_to"; location: string; lat: number; lng: number; zoom?: number }
  | { type: "fit_bounds"; north: number; south: number; east: number; west: number }
  | { type: "set_zoom"; zoom: number }
  | { type: "set_base_layer"; layer: "satellite" | "terrain" | "dark" }
  | { type: "toggle_layer"; layer: "pre" | "post" | "buildings" | "predicted"; visible?: boolean }
  | { type: "set_layer_opacity"; layer: "pre" | "post" | "buildings" | "predicted"; opacity: number }
  | { type: "place_marker"; lat: number; lng: number; label?: string }
  | { type: "clear_markers" }
  | { type: "fit_to_dataset" }
  | { type: "show_damage_path"; visible: boolean }
