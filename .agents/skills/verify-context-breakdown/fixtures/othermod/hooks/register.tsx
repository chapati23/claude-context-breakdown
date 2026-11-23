import type { Register } from 'claude-code'

export const register: Register = on => {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text color="cyan">OTHER MOD ROW · this row comes first</Text>
  })
}
