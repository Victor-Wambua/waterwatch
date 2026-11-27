export const sensorKindLabel = (k: string) => ({ flow: 'Flow', level: 'Tank level', pump_status: 'Pump status', pressure: 'Pressure', quality: 'Water quality' } as Record<string, string>)[k] ?? k;
