// "退室しますか？" (core-owned sheet). Leaving closes orders and opens tonight's recap.
import { common } from '../i18n/common'
import { naviApi } from '../core/store'
import { Button } from '../core/ui/Button'

export function ExitConfirm() {
  const t = common.useT()
  return (
    <div className="exit-confirm">
      <h2 className="exit-confirm__title">{t('exit.title')}</h2>
      <p className="exit-confirm__body">{t('exit.body')}</p>
      <div className="exit-confirm__row">
        <Button kind="secondary" size="lg" full onClick={() => naviApi.getState().closeSheet()} testid="exit-cancel">
          {t('exit.cancel')}
        </Button>
        <Button
          kind="primary"
          size="lg"
          full
          testid="exit-confirm"
          onClick={() => {
            const s = naviApi.getState()
            s.closeSheet()
            s.exitRoom()
          }}
        >
          {t('exit.confirm')}
        </Button>
      </div>
    </div>
  )
}
