/**
 * ActivityErrorBoundary — Souza/JS.
 *
 * Wraps ActivityFeed (and any other runtime-status surface) so a single
 * malformed event payload can't take down the whole conversation render.
 * On error, the boundary renders a small diagnostic strip and lets the
 * rest of the chat (messages, input, scroll) keep working.
 *
 * React 19 still requires class components for error boundaries — there is
 * no `useErrorBoundary` hook in core.
 */
import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Optional label to identify which surface failed in the diagnostic. */
  label?: string;
}

interface State {
  error: Error | null;
}

export class ActivityErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    // eslint-disable-next-line no-console
    console.error(
      `[ActivityErrorBoundary] ${this.props.label || "runtime"}:`,
      error,
    );
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="activity-error-boundary">
          <div className="activity-error-title">
            ⚠ Painel de atividade falhou — log enviado ao console
          </div>
          <div className="activity-error-detail">
            <code>{this.state.error.message || "Erro sem mensagem"}</code>
          </div>
          <button
            type="button"
            className="activity-error-reset"
            onClick={this.reset}
          >
            Tentar novamente
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
