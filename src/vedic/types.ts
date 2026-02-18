export interface VedicThesisItem {
  theme: string;
  do: string[];
  avoid: string[];
  practices: string[];
}

export interface PanchangFactNode {
  name: string | null;
  number: number | null;
  start: string | null;
  end: string | null;
}

export interface VedicPanchangJson {
  dateLocal: string;
  timezone: string;
  sunrise: string | null;
  sunset: string | null;
  vara: string | null;
  paksha: string | null;
  tithi: PanchangFactNode;
  nakshatra: PanchangFactNode;
  yoga: { name: string | null };
  karana: { name: string | null };
  moonPhase: string | null;
}

export interface MergedTheses {
  defaults: VedicThesisItem;
  selected: {
    tithi: VedicThesisItem;
    nakshatra: VedicThesisItem;
    vara: VedicThesisItem;
  };
}
