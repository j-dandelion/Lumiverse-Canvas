import type { SlashCommandDef } from './types'

export class CommandRegistry {
  private commands = new Map<string, SlashCommandDef>()

  register(command: SlashCommandDef): () => void {
    this.commands.set(command.name, command)
    return () => {
      // Only unregister if the current entry is the one we registered.
      // Avoids race where a newer registration is silently removed.
      if (this.commands.get(command.name) === command) {
        this.commands.delete(command.name)
      }
    }
  }

  lookup(name: string): SlashCommandDef | undefined {
    return this.commands.get(name)
  }

  list(): SlashCommandDef[] {
    return Array.from(this.commands.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    )
  }

  clear(): void {
    this.commands.clear()
  }
}
