import { motion } from 'motion/react'

const NAME = 'Jason Li'

export function Hero({ reducedMotion }: { reducedMotion: boolean }) {
  const words = NAME.split(' ')
  return (
    <section id="hero" className="hero">
      <div className="hero-inner">
        <h1 className="hero-name" aria-label={NAME}>
          {words.map((w, wi) => (
            <span className="hero-word" key={w} aria-hidden="true">
              {w.split('').map((ch, ci) => (
                <motion.span
                  key={ci}
                  className="hero-letter"
                  initial={reducedMotion ? false : { y: '110%' }}
                  animate={{ y: '0%' }}
                  transition={{
                    duration: 0.9,
                    delay: 0.15 + (wi * 5 + ci) * 0.045,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                >
                  {ch}
                </motion.span>
              ))}
            </span>
          ))}
        </h1>
        <motion.p
          className="hero-sub"
          initial={reducedMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.9, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          Payments, FX and stablecoin infrastructure by day. A globe of every place
          photographed in person.
        </motion.p>
      </div>
      <motion.div
        className="scroll-cue"
        initial={reducedMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.7, duration: 1 }}
        aria-hidden="true"
      >
        <span className="mono">scroll</span>
        <span className="scroll-line" />
      </motion.div>
    </section>
  )
}
