type Props = {
  isOn: boolean;
};

/** The small status light used in the header and on device cards. */
export const Dot = ({ isOn }: Props) => <span className={isOn ? 'Dot Dot-on' : 'Dot'} />;
