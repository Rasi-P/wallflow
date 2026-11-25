import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

export class SceneErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('The wall could not render:', error, info.componentStack) }
  render() {
    if (this.state.failed) return <div className="webgl-fallback"><h2>Let’s get your wall back.</h2><p>Check that hardware acceleration is enabled in your browser, then reload.</p><button className="primary-button" onClick={() => window.location.reload()}>Reload wall</button></div>
    return this.props.children
  }
}
