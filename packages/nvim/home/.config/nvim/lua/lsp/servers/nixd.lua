-- nixd (Nix) LSP server configuration.
--
-- nixd and nixfmt both come from the nix profile, not mason:
--   nix profile install github:nix-community/nixd
--   nix profile install nixpkgs#nixfmt
-- ~/.nix-profile/bin is on PATH for login shells, but a GUI-launched nvim can
-- inherit a thinner environment, so fall back to the profile path explicitly.
-- The profile symlink is stable across upgrades; the store path is not.
local function nix_bin(name)
  if vim.fn.executable(name) == 1 then return name end
  return vim.fn.expand('~/.nix-profile/bin/' .. name)
end

return {
  cmd = { nix_bin('nixd') },
  filetypes = { 'nix' },
  single_file_support = true,
  settings = {
    nixd = {
      -- Formatting is normally driven by conform (formatters_by_ft.nix), this
      -- keeps :lua vim.lsp.buf.format() and lsp_format = 'fallback' honest.
      formatting = { command = { nix_bin('nixfmt') } },
      -- Deliberately no `nixpkgs.expr` / `options.*`: those make nixd evaluate
      -- all of nixpkgs for completion, which costs GBs of RSS on every nix
      -- buffer. File-level diagnostics and formatting work without it.
    },
  },
}
