/**
 * 字段值表格（列表与详情共用），展示复用 `@flomo/shared` 的 `formatFieldValue`。
 */
import { formatFieldValue, isFieldValueEmpty } from '@flomo/shared';
import type { FieldDefinition, FieldValue } from '@flomo/shared';

export interface FieldValueTableProps {
  fields: readonly FieldDefinition[];
  values: Record<string, FieldValue>;
  /** 字段定义缺失（模板已硬删除）时是否回退显示原始键值 */
  fallbackRaw?: boolean;
}

export default function FieldValueTable({ fields, values, fallbackRaw = true }: FieldValueTableProps): JSX.Element | null {
  const rows: Array<{ key: string; label: string; text: string; url?: string }> = [];

  for (const def of fields) {
    const value = values[def.key];
    if (isFieldValueEmpty(value)) continue;
    const text = formatFieldValue(def, value);
    if (text === '') continue;
    if (def.type === 'url' && typeof value === 'string') {
      rows.push({ key: def.key, label: def.label, text, url: value });
    } else {
      rows.push({ key: def.key, label: def.label, text });
    }
  }

  if (rows.length === 0 && fallbackRaw) {
    for (const [key, value] of Object.entries(values)) {
      if (isFieldValueEmpty(value)) continue;
      if (fields.some((def) => def.key === key)) continue;
      rows.push({ key, label: key, text: Array.isArray(value) ? value.join('、') : String(value) });
    }
  }

  if (rows.length === 0) return null;

  return (
    <div className="memo-values">
      <table>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">{row.label}</th>
              <td>
                {row.url !== undefined ? (
                  <a href={row.url} target="_blank" rel="noreferrer noopener">
                    {row.text}
                  </a>
                ) : (
                  row.text
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
