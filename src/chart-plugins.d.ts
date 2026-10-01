import type { ChartType } from 'chart.js';

export interface MonthSection {
  label: string;
  start: number;
  end: number;
}

declare module 'chart.js' {
  interface PluginOptionsByType<TType extends ChartType> {
    monthSection?: { sections: MonthSection[] };
  }
}
