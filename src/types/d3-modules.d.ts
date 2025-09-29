declare module 'd3-scale' {
  export type BandDomain = string | number;
  export interface ScaleBand<Domain extends BandDomain = string> {
    (value: Domain): number | undefined;
    domain(domain: Domain[]): this;
    range(range: [number, number]): this;
    padding(padding: number): this;
    bandwidth(): number;
    step(): number;
  }
  export interface ScaleLinear {
    (value: number): number;
    domain(domain: [number, number]): this;
    range(range: [number, number]): this;
    nice(): this;
    ticks(count: number): number[];
  }
  export function scaleBand<
    Domain extends BandDomain = string,
  >(): ScaleBand<Domain>;
  export function scaleLinear(): ScaleLinear;
}

declare module 'd3-array' {
  export function min<T>(
    iterable: Iterable<T>,
    accessor: (datum: T) => number,
  ): number | undefined;
  export function max<T>(
    iterable: Iterable<T>,
    accessor: (datum: T) => number,
  ): number | undefined;
}
