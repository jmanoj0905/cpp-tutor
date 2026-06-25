export interface ExecPoint {
  line: number;
  event: string;
  func_name: string;
  stack_to_render: unknown[];
  heap: Record<string, unknown>;
  globals: Record<string, unknown>;
  ordered_globals: string[];
  stdout: string;
}
export interface Trace { code: string; trace: ExecPoint[]; }
export interface CompileError { status: "compile_error"; message: string; line: number | null; }
export type TraceResult = Trace | CompileError;
export const isCompileError = (r: TraceResult): r is CompileError =>
  (r as CompileError).status === "compile_error";
