-- Biome LSP server configuration
-- Modern alternative to ESLint + Prettier with better performance.
-- Note: the biome LSP reads its configuration from the project's biome.json;
-- LSP `settings` are not consumed, so none are set here.
return {
  filetypes = { 'javascript', 'javascriptreact', 'typescript', 'typescriptreact', 'json', 'jsonc' },
  single_file_support = true,
}
