/**
 * 404 页面。
 */
import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../lib/useDocumentTitle';

export default function NotFoundPage(): JSX.Element {
  useDocumentTitle('页面不存在');
  return (
    <div className="page">
      <div className="card center">
        <div className="empty">
          <span className="empty-icon" aria-hidden="true">
            🧭
          </span>
          <h1 className="page-title">404 · 页面不存在</h1>
          <p className="muted mt-8">你访问的地址可能已被移动或删除。</p>
          <p className="mt-16">
            <Link to="/" className="btn btn-primary">
              返回记录页
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
