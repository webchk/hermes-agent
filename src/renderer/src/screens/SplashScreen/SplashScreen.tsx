import { useEffect } from "react";
import splashBg from "../../assets/hermesbg.webp";
import splashLogo from "../../assets/splashtext-w.webp";
import { MorphingText } from "../../components/ui/MorphingText";

interface SplashScreenProps {
  onFinished: () => void;
}

const SPLASH_PHRASES = [
  "Inicializando agente.",
  "Carregando skills.",
  "Conectando ao gateway.",
  "Sincronizando memória.",
  "Pronto.",
];

function SplashScreen({ onFinished }: SplashScreenProps): React.JSX.Element {
  useEffect(() => {
    onFinished();
  }, [onFinished]);

  return (
    <div className="splash-screen">
      <img className="splash-bg" src={splashBg} alt="" />
      <img className="splash-logo" src={splashLogo} alt="Hermes Agent" />
      <div className="splash-tagline">
        <MorphingText
          words={SPLASH_PHRASES}
          interval={1100}
          morphDuration={500}
        />
      </div>
    </div>
  );
}

export default SplashScreen;
