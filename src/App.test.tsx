import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('Edgeboard dashboard', () => {
  it('filters paper candidates by sport', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Tennis' }))

    expect(screen.getByText('Alcaraz vs. Sinner')).toBeInTheDocument()
    expect(screen.queryByText('Knicks @ Celtics')).not.toBeInTheDocument()
  })

  it('searches candidate matchups', () => {
    render(<App />)

    fireEvent.change(screen.getByLabelText('Search candidates'), {
      target: { value: 'chiefs' },
    })

    expect(screen.getByText('Chiefs @ Bills')).toBeInTheDocument()
    expect(screen.queryByText('Alcaraz vs. Sinner')).not.toBeInTheDocument()
  })
})
