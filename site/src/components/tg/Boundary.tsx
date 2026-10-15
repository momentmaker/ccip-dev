import { Component, type ReactNode } from 'react';
import { failureText } from '../../lib/tg';

export function OutOfReach() {
  return (
    <p className="tg-state" role="status">
      LinkMarines is out of reach right now. Close the app and open it again in a minute.
    </p>
  );
}

/** Telegram's script throws on a strict parameter, and React unmounts an app that lets a throw through; this keeps the line above instead of a blank screen. */
export class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    console.warn(failureText(error));
  }

  render(): ReactNode {
    return this.state.failed ? <OutOfReach /> : this.props.children;
  }
}
