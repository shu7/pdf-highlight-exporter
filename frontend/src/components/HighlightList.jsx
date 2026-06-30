import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

function SortableItem({ item, index, onNoteChange, onDelete, t }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm"
    >
      <div className="flex items-start gap-2">
        {/* ドラッグハンドル */}
        <button
          {...attributes}
          {...listeners}
          className="mt-0.5 cursor-grab select-none px-1 text-gray-400 hover:text-gray-600 active:cursor-grabbing"
          title={t.dragReorder}
        >
          ⠿
        </button>

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2 text-xs text-gray-400">
            <span className="font-medium text-gray-500">#{index + 1}</span>
            {item.page != null && <span>p.{item.page}</span>}
            <span
              className="inline-block h-3 w-3 rounded-sm border border-gray-300"
              style={{ backgroundColor: item.color || '#FFFF00' }}
            />
          </div>

          <p className="whitespace-pre-wrap break-words text-sm text-gray-800">
            {item.text}
          </p>

          <input
            type="text"
            value={item.note || ''}
            onChange={(e) => onNoteChange(item.id, e.target.value)}
            placeholder={t.notePlaceholder}
            className="mt-2 w-full rounded border border-gray-200 px-2 py-1 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </div>

        <button
          onClick={() => onDelete(item.id)}
          className="px-1 text-gray-300 hover:text-red-500"
          title={t.deleteTitle}
        >
          ✕
        </button>
      </div>
    </li>
  )
}

export default function HighlightList({
  highlights,
  onReorder,
  onNoteChange,
  onDelete,
  t,
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  )

  function handleDragEnd(event) {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = highlights.findIndex((h) => h.id === active.id)
      const newIndex = highlights.findIndex((h) => h.id === over.id)
      onReorder(arrayMove(highlights, oldIndex, newIndex))
    }
  }

  if (highlights.length === 0) {
    return (
      <p className="px-2 py-8 text-center text-sm text-gray-400">
        {t.emptyList1}
        <br />
        {t.emptyList2}
      </p>
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={highlights.map((h) => h.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul className="space-y-2">
          {highlights.map((item, index) => (
            <SortableItem
              key={item.id}
              item={item}
              index={index}
              onNoteChange={onNoteChange}
              onDelete={onDelete}
              t={t}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  )
}
