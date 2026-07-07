import { Toaster as Sonner, ToasterProps } from 'sonner'

const Toaster = ({ closeButton = true, ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      closeButton={closeButton}
      {...props}
    />
  )
}

export { Toaster }
