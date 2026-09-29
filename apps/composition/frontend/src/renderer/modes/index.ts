// Side-effect barrel: each import registers one RenderPlugin at module load.
// Modes are added by later tasks. Order is irrelevant (self-registration).
// Each mode module must stay decoupled — no cross-mode imports.
import './default'
import './iso'
import './top'
import './topBillboard'
import './free3d'
import './mesh3d'
