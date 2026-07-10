export const bigintTransformer = {
  to(value: number | null | undefined): number | null | undefined {
    return value;
  },
  from(value: string | number | null): number | null {
    if (value === null || value === undefined) return null;
    return Number(value);
  }
};
