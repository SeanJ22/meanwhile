
export interface FactoryLearning {
  readonly secondCoverage: { readonly pairs: number; readonly firstMs: number; readonly secondMs: number; readonly ratio: number | null };
  readonly headStart: { readonly solved: number; readonly measured: number; readonly share: number | null };
  readonly detectiveReuse: number | null;
  readonly factsByWeek: readonly { readonly week: string; readonly facts: number; readonly observedHours: number; readonly perHour: number }[];
}

