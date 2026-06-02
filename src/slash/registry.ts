// In-memory command registry. Single Canvas instance.
import type { SlashCommandDef } from './types'

export class CommandRegistry {
  private commands = new Map<string, SlashCommandDef>()

  register(command: SlashCommandDef): () => void {
    this.commands.set(command.name, command)
    return () => this.commands.delete(command.name)
  }

  lookup(name: string): SlashCommandDef | undefined {
    return this.commands.get(name)
  }

  list(): SlashCommandDef[] {
    return Array.from(this.commands.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    )
  }
}
