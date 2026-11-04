import { spellHighlighter } from '../../spell/spellcheck'
import { registerActions } from '../actions'

registerActions({
  // View ▸ Check spelling, as MainWindow._toggle_spell_check.
  spell_check: on => spellHighlighter().setEnabled(on !== false),
})
