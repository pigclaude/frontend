// 负责渲染第一阶段列表的 decimal string 游标翻页按钮。
interface PagerProps {
  hasNext: boolean
  isFetching: boolean
  onNext: () => void
}

/** 只提供服务端返回 nextCursor 时的下一页操作，避免客户端猜测总数。 */
export function Pager({ hasNext, isFetching, onNext }: PagerProps) {
  return (
    <div className="admin-pager">
      <span className="admin-muted">{hasNext ? "还有更多记录" : "已到末页"}</span>
      <button
        className="admin-button"
        type="button"
        disabled={!hasNext || isFetching}
        onClick={onNext}
      >
        {isFetching ? "加载中…" : "下一页"}
      </button>
    </div>
  )
}
