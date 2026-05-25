export interface LLMProvider {
  complete(system: string, user: string): Promise<string>;
}
