import styles from "./governing-skeleton.module.css";

export function GoverningSkeleton() {
  return (
    <div className={`coverage-notice ${styles.skeleton}`} data-governing-skeleton role="status" aria-label="Loading Who governs here" aria-busy="true">
      <p className={styles.heading}>Who governs here</p>
      <div aria-hidden="true">
        <span className={styles.line} /><span className={styles.line} />
        <span className={styles.line} /><span className={styles.line} />
      </div>
    </div>
  );
}
