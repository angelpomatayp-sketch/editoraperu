interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog(props: ConfirmDialogProps): React.JSX.Element {
  return (
    <div className="overlay" role="alertdialog" aria-labelledby="confirm-title">
      <div className="dialog">
        <h2 id="confirm-title">{props.title}</h2>
        <p>{props.message}</p>
        <div className="dialog__actions">
          <button type="button" className="touch-button touch-button--secondary" onClick={props.onCancel}>
            {props.cancelLabel}
          </button>
          <button type="button" className="touch-button" onClick={props.onConfirm}>
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
