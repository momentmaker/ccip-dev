import Segmented from './Segmented';

type Shape = '16:9' | '1:1' | '9:16';
const ICON: Record<Shape, { w: number; h: number }> = { '16:9': { w: 18, h: 10 }, '1:1': { w: 12, h: 12 }, '9:16': { w: 9, h: 15 } };

export default function ShapePicker(props: { value: Shape; onChange: (value: Shape) => void; disabled?: boolean }) {
  return (
    <Segmented
      label="Shape"
      className="shape-picker"
      value={props.value}
      onChange={props.onChange}
      disabled={props.disabled}
      options={(Object.keys(ICON) as Shape[]).map((shape) => ({
        value: shape,
        title: shape,
        label: (
          <>
            <i className="shape-i" style={{ width: ICON[shape].w, height: ICON[shape].h }} aria-hidden="true" />
            <span className="visually-hidden">{shape}</span>
          </>
        ),
      }))}
    />
  );
}
