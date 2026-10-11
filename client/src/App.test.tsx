import { fireEvent, render, screen } from '@solidjs/testing-library'
import { expect, test } from 'vitest'
import App from './App'

test('the Vite scaffold renders and updates Solid state', () => {
  render(() => <App />)
  expect(screen.getByRole('heading', { name: 'Get started' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Count is 0' }))
  expect(screen.getByRole('button', { name: 'Count is 1' })).toBeInTheDocument()
})
