import './styles.css'

const features = [
  'Realtime collaboration',
  'Focused writing mode',
  'One-click publishing'
]

export function App() {
  return (
    <main className="launch-card" aria-label="Orbit Notes launch">
      <span className="status">Ready to launch</span>
      <p className="eyebrow">ORBIT NOTES</p>
      <h1>Ideas move faster<br />when the tools disappear.</h1>
      <p className="summary">
        A calm workspace for notes, decisions, and the work that follows.
      </p>
      <ul>
        {features.map((feature) => <li key={feature}>{feature}</li>)}
      </ul>
      <button>Start writing</button>
    </main>
  )
}
