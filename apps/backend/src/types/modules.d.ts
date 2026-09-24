declare module 'uuid' {
  export function v4(): string;
  export function v1(): string;
  export function v3(): string;
  export function v5(): string;
  export function validate(uuid: string): boolean;
  export function version(uuid: string): number;
}
