import { homedir } from 'node:os'
import { join } from 'node:path'

export const home = process.env.RITOKO_HOME ?? join(homedir(), '.ritoko')

export const paths = {
  profile: join(home, 'profile'),
  workflows: join(home, 'workflows'),
  runs: join(home, 'runs'),
  db: join(home, 'ritoko.db'),
}
