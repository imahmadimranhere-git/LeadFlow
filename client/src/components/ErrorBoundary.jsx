// Catches crashes in a page so one bug doesn't turn the whole app white.
// Shows a friendly message — never the technical error to the user.
import { Component } from 'react';
import { ErrorState } from './states.jsx';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    if (import.meta.env.DEV) console.error('UI error:', error); // dev only
  }

  componentDidUpdate(prevProps) {
    // navigating to another page clears the error
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) this.setState({ hasError: false });
  }

  render() {
    if (this.state.hasError) {
      return (
        <ErrorState
          title="This page ran into a problem"
          message="Please try again. If it keeps happening, contact support."
          onRetry={() => this.setState({ hasError: false })}
        />
      );
    }
    return this.props.children;
  }
}
