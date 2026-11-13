/** Icon per measured variable (design). Unknown variables get a generic sensor icon. */
const ICONS: Record<string, string> = {
  temp: 'thermostat',
  rh: 'humidity_percentage',
  ppfd: 'light_mode',
  moist: 'water_drop',
  ph: 'science',
  ec: 'bolt',
  // Variables of the real Lefi node profile (lefi-node-esp32.v1).
  air_temperature: 'thermostat',
  air_humidity: 'humidity_percentage',
  soil_temperature: 'thermostat',
  water_temperature: 'thermostat',
  water_tds: 'bolt',
  soil_moisture: 'water_drop',
};

export const variableIcon = (variable: string) => ICONS[variable] ?? 'sensors';
