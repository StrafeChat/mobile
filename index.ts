// Entry point. The shared web stores read localStorage, window and the device language at
// module load, so the environment shims install before expo-router loads any screen.
import './src/platform/shims';
import 'expo-router/entry';
