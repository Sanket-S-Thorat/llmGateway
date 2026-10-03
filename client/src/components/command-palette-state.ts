export const COMMAND_PALETTE_EVENT = 'llmgateway:command-palette'

export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent(COMMAND_PALETTE_EVENT))
}
